use std::collections::{HashMap, HashSet};
use std::mem;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::native::glob::glob_files::glob_files;
use crate::native::hasher::hash;
use crate::native::logger::enable_logger;
use crate::native::project_graph::utils::{ProjectRootMappings, find_project_for_path};
use crate::native::types::FileData;
use crate::native::utils::{Normalize, NxCondvar, NxMutex, path::get_child_files};
use crate::native::workspace::files_archive::{read_files_archive, write_files_archive};
use crate::native::workspace::files_hashing::{full_files_hash, selective_files_hash};
use crate::native::workspace::types::{
    FileMap, NxWorkspaceFilesExternals, ProjectFiles, UpdatedWorkspaceFiles,
};
use crate::native::workspace::{types::NxWorkspaceFiles, workspace_files};
use napi::bindgen_prelude::External;
use rayon::prelude::*;
use tracing::{trace, warn};
use xxhash_rust::xxh3;

#[derive(Default)]
struct RawFilesByRoot {
    workspace_files: Vec<(PathBuf, String)>,
    additional_root_files: HashMap<String, Vec<(PathBuf, String)>>,
}

#[napi(object)]
#[derive(Default)]
pub struct FilePathsByRoot {
    pub workspace_files: Vec<String>,
    pub additional_root_files: HashMap<String, Vec<String>>,
}

#[napi]
pub struct WorkspaceContext {
    pub workspace_root: String,
    workspace_root_path: PathBuf,
    additional_project_roots: Vec<String>,
    files_worker: FilesWorker,
}

type Files = Vec<(PathBuf, String)>;

fn gather_and_hash_files(workspace_root: &Path, additional_project_roots: &[PathBuf], cache_dir: String) -> RawFilesByRoot {
    let archived_files = read_files_archive(&cache_dir);

    trace!("Gathering files in {}", workspace_root.display());
    let now = std::time::Instant::now();
    
    // Gather files from workspace root
    let workspace_file_hashes = if let Some(archived_files) = archived_files {
        selective_files_hash(workspace_root, archived_files)
    } else {
        full_files_hash(workspace_root)
    };

    let mut workspace_files = workspace_file_hashes
        .iter()
        .map(|(path, file_hashed)| (PathBuf::from(path), file_hashed.0.to_owned()))
        .collect::<Vec<_>>();
    workspace_files.par_sort();

    let mut additional_root_files = HashMap::new();
    let mut all_file_hashes = workspace_file_hashes;

    // Gather files from additional project roots
    for additional_root_path in additional_project_roots {
        if additional_root_path.exists() {
            trace!("Gathering files in additional root: {}", additional_root_path.display());
            let additional_file_hashes = full_files_hash(additional_root_path);

            // Get the relative path from workspace root to additional root
            let relative_root_path = additional_root_path.strip_prefix(workspace_root).unwrap_or(additional_root_path);

            let mut root_files = additional_file_hashes
                .iter()
                .map(|(path, file_hashed)| {
                    // Prepend the relative root path to make it relative to workspace root
                    let full_path = relative_root_path.join(path);
                    (full_path, file_hashed.0.to_owned())
                })
                .collect::<Vec<_>>();
            root_files.par_sort();

            additional_root_files.insert(additional_root_path.to_string_lossy().to_string(), root_files);

            // Extend the hashmap with additional files for archive
            for (path, file_hashed) in additional_file_hashes.iter() {
                let full_path = relative_root_path.join(path);
                all_file_hashes.insert(full_path.to_string_lossy().to_string(), file_hashed.clone());
            }
        } else {
            warn!("Additional project root does not exist: {}", additional_root_path.display());
        }
    }

    trace!("hashed and sorted files in {:?}", now.elapsed());

    write_files_archive(&cache_dir, all_file_hashes);

    RawFilesByRoot {
        workspace_files,
        additional_root_files,
    }
}

#[derive(Default)]
struct FilesWorker(Option<Arc<(NxMutex<RawFilesByRoot>, NxCondvar)>>);
impl FilesWorker {
    #[cfg(not(target_arch = "wasm32"))]
    fn gather_files(workspace_root: &Path, additional_project_roots: &[PathBuf], cache_dir: String) -> Self {
        if !workspace_root.exists() {
            warn!(
                "workspace root does not exist: {}",
                workspace_root.display()
            );
            return FilesWorker(None);
        }

        let files_lock = Arc::new((NxMutex::new(RawFilesByRoot::default()), NxCondvar::new()));
        let files_lock_clone = Arc::clone(&files_lock);
        let workspace_root = workspace_root.to_owned();
        let additional_project_roots = additional_project_roots.to_vec();

        std::thread::spawn(move || {
            let (lock, cvar) = &*files_lock_clone;
            trace!("Initially locking files");
            let mut workspace_files = lock.lock().expect("Should be the first time locking files");

            let files = gather_and_hash_files(&workspace_root, &additional_project_roots, cache_dir);

            *workspace_files = files;
            trace!("files retrieved");

            drop(workspace_files);
            cvar.notify_all();
        });

        FilesWorker(Some(files_lock))
    }

    #[cfg(target_arch = "wasm32")]
    fn gather_files(workspace_root: &Path, additional_project_roots: &[PathBuf], cache_dir: String) -> Self {
        if !workspace_root.exists() {
            warn!(
                "workspace root does not exist: {}",
                workspace_root.display()
            );
            return FilesWorker(None);
        }

        let workspace_root = workspace_root.to_owned();

        let files = gather_and_hash_files(&workspace_root, additional_project_roots, cache_dir);

        trace!("files retrieved");

        let files_lock = Arc::new((NxMutex::new(files), NxCondvar::new()));

        FilesWorker(Some(files_lock))
    }

    fn get_raw_files(&self) -> RawFilesByRoot {
        if let Some(files_sync) = &self.0 {
            let (files_lock, cvar) = files_sync.deref();

            trace!("waiting for files to be available");
            let files = files_lock.lock().expect("Should be able to lock files");

            #[cfg(target_arch = "wasm32")]
            let files = cvar
                .wait(files, |guard| !guard.workspace_files.is_empty() || !guard.additional_root_files.is_empty())
                .expect("Should be able to wait for files");

            #[cfg(not(target_arch = "wasm32"))]
            let files = cvar
                .wait(files, |guard| !guard.workspace_files.is_empty() || !guard.additional_root_files.is_empty())
                .expect("Should be able to wait for files");

            let raw_files = files.clone();

            drop(files);

            trace!("files are available");
            raw_files
        } else {
            RawFilesByRoot::default()
        }
    }

    pub fn update_files(
        &self,
        workspace_root_path: &Path,
        updated_files: Vec<&str>,
        deleted_files_and_directories: Vec<&str>,
    ) -> HashMap<String, String> {
        let Some(files_sync) = &self.0 else {
            trace!("there were no files because the workspace root did not exist");
            return HashMap::new();
        };

        let (files_lock, _) = &files_sync.deref();
        let mut files = files_lock
            .lock()
            .expect("Should always be able to update files");
        let mut map: HashMap<PathBuf, String> = files.drain(..).collect();

        for deleted_path in deleted_files_and_directories {
            // If the path is a file, this removes it.
            let removal = map.remove(&PathBuf::from(deleted_path));
            if removal.is_none() {
                // If the path is a directory, this retains only files not in the directory.
                map.retain(|path, _| {
                    let owned_deleted_path = deleted_path.to_owned();
                    !path.starts_with(owned_deleted_path + "/")
                });
            };
        }

        let updated_files_hashes: HashMap<String, String> = updated_files
            .par_iter()
            .filter_map(|path| {
                let full_path = workspace_root_path.join(path);
                let Ok(content) = std::fs::read(&full_path) else {
                    trace!("could not read file: {full_path:?}");
                    return None;
                };
                Some((path.to_string(), hash(&content)))
            })
            .collect();

        for (file, hash) in &updated_files_hashes {
            map.entry(file.into())
                .and_modify(|e| e.clone_from(hash))
                .or_insert(hash.clone());
        }

        *files = map.into_iter().collect();
        files.par_sort();

        updated_files_hashes
    }
}

#[napi]
impl WorkspaceContext {
    #[napi(constructor)]
    pub fn new(workspace_root: String, additional_project_roots: Vec<String>, cache_dir: String) -> Self {
        enable_logger();

        trace!(?workspace_root, ?additional_project_roots);

        let workspace_root_path = PathBuf::from(&workspace_root);
        let additional_project_root_paths: Vec<PathBuf> = additional_project_roots
            .iter()
            .map(|root| PathBuf::from(root))
            .collect();

        WorkspaceContext {
            files_worker: FilesWorker::gather_files(&workspace_root_path, &additional_project_root_paths, cache_dir.clone()),
            workspace_root,
            workspace_root_path,
            additional_project_roots,
        }
    }

    #[napi]
    pub fn get_workspace_files(
        &self,
        project_root_map: HashMap<String, String>,
    ) -> anyhow::Result<NxWorkspaceFiles> {
        workspace_files::get_files(project_root_map, self.all_file_data())
            .map_err(anyhow::Error::from)
    }

    #[napi]
    pub fn glob(
        &self,
        globs: Vec<String>,
        exclude: Option<Vec<String>>,
    ) -> napi::Result<Vec<String>> {
        let file_data = self.all_file_data();
        let globbed_files = glob_files(&file_data, globs, exclude)?;
        Ok(globbed_files.map(|file| file.file.to_owned()).collect())
    }

    /// Performs multiple glob pattern matches against workspace files in parallel
    /// @returns An array of arrays, where each inner array contains the file paths
    /// that matched the corresponding glob pattern in the input. The outer array maintains the same order
    /// as the input globs.
    #[napi]
    pub fn multi_glob(
        &self,
        globs: Vec<String>,
        exclude: Option<Vec<String>>,
    ) -> napi::Result<FilePathsByRoot> {
        let raw_files = self.files_worker.get_raw_files();
        let mut workspace_files = Vec::new();
        let mut additional_root_files = HashMap::new();

        // Process workspace files
        let workspace_file_data: Vec<FileData> = raw_files.workspace_files
            .iter()
            .map(|(path, hash)| FileData {
                file: path.to_normalized_string(),
                hash: hash.clone(),
            })
            .collect();
        
        let globbed_files = glob_files(&workspace_file_data, globs.clone(), exclude.clone())?;
        workspace_files = globbed_files.map(|file| file.file.to_owned()).collect();

        // Process additional root files
        for (root_path, root_files) in &raw_files.additional_root_files {
            let root_file_data: Vec<FileData> = root_files
                .iter()
                .map(|(path, hash)| FileData {
                    file: path.to_normalized_string(),
                    hash: hash.clone(),
                })
                .collect();
            
            let globbed_files = glob_files(&root_file_data, globs.clone(), exclude.clone())?;
            let file_paths: Vec<String> = globbed_files.map(|file| file.file.to_owned()).collect();
            additional_root_files.insert(root_path.clone(), file_paths);
        }

        Ok(FilePathsByRoot {
            workspace_files,
            additional_root_files,
        })
    }

    #[napi]
    pub fn hash_files_matching_globs(
        &self,
        glob_groups: Vec<Vec<String>>,
    ) -> napi::Result<Vec<String>> {
        let files = &self.all_file_data();
        let hashes = glob_groups
            .into_iter()
            .map(|globs| {
                let globbed_files = glob_files(files, globs, None)?.collect::<Vec<_>>();
                let mut hasher = xxh3::Xxh3::new();
                for file in globbed_files {
                    hasher.update(file.file.as_bytes());
                    hasher.update(file.hash.as_bytes());
                }
                Ok(hasher.digest().to_string())
            })
            .collect::<napi::Result<Vec<_>>>()?;

        Ok(hashes)
    }

    #[napi]
    pub fn hash_files_matching_glob(
        &self,
        globs: Vec<String>,
        exclude: Option<Vec<String>>,
    ) -> napi::Result<String> {
        let files = &self.all_file_data();
        let globbed_files = glob_files(files, globs, exclude)?.collect::<Vec<_>>();

        let mut hasher = xxh3::Xxh3::new();
        for file in globbed_files {
            hasher.update(file.file.as_bytes());
            hasher.update(file.hash.as_bytes());
        }

        Ok(hasher.digest().to_string())
    }

    #[napi]
    pub fn incremental_update(
        &self,
        updated_files: Vec<&str>,
        deleted_files: Vec<&str>,
    ) -> HashMap<String, String> {
        self.files_worker
            .update_files(&self.workspace_root_path, updated_files, deleted_files)
    }

    #[napi]
    pub fn update_project_files(
        &self,
        project_root_mappings: ProjectRootMappings,
        project_files: External<ProjectFiles>,
        global_files: External<Vec<FileData>>,
        updated_files: HashMap<String, String>,
        deleted_files: Vec<&str>,
    ) -> UpdatedWorkspaceFiles {
        trace!("updating project files");
        trace!("{project_root_mappings:?}");
        let mut project_files_map = project_files.clone();
        let mut global_files = global_files
            .iter()
            .map(|f| (f.file.clone(), f.hash.clone()))
            .collect::<HashMap<_, _>>();

        trace!(
            "adding {} updated files to project files",
            updated_files.len()
        );

        let mut updated_projects = HashSet::<&str>::new();
        for updated_file in updated_files.into_iter() {
            let file = updated_file.0;
            let hash = updated_file.1;
            let project = find_project_for_path(&file, &project_root_mappings);
            if let Some(project_files) =
                project.and_then(|project| project_files_map.get_mut(project))
            {
                trace!("{file:?} was found in a project");
                if let Some(file) = project_files.iter_mut().find(|f| f.file == file) {
                    trace!("updating hash for file");
                    file.hash = hash;
                } else {
                    trace!("{file:?} was not part of a project, adding to project files");
                    project_files.push(FileData { file, hash });
                    updated_projects.insert(project.expect("Project already exists"));
                }
            } else {
                trace!("{file:?} was not found in any project, updating global files");
                global_files
                    .entry(file)
                    .and_modify(|e| e.clone_from(&hash))
                    .or_insert(hash);
            }
        }

        trace!(
            "removing {} deleted files from project files",
            deleted_files.len()
        );
        for deleted_file in deleted_files.into_iter() {
            if let Some(project_files) = find_project_for_path(deleted_file, &project_root_mappings)
                .and_then(|project| project_files_map.get_mut(project))
            {
                if let Some(pos) = project_files.iter().position(|f| f.file == deleted_file) {
                    trace!("removing file: {deleted_file:?} from project");
                    project_files.remove(pos);
                }
            }

            if global_files.contains_key(deleted_file) {
                trace!("removing {deleted_file:?} from global files");
                global_files.remove(deleted_file);
            }
        }

        // sort the updated projects after deletion
        // projects that have deleted files were not added to `updated_projects` set because deletion doesnt change the determinism
        // but if there were any files deleted from projects, the sort should be faster becaues there potentially could be less files to sort
        for updated_project in updated_projects {
            trace!(updated_project, "sorting updated project");
            if let Some(project_files) = project_files_map.get_mut(updated_project) {
                // if the project files are less than 500, then parallel sort has too much overhead to actually be faster
                if cfg!(target_arch = "wasm32") || project_files.len() < 500 {
                    project_files.sort();
                } else {
                    project_files.par_sort();
                }
            }
        }

        let non_project_files = global_files
            .into_iter()
            .map(|(file, hash)| FileData { file, hash })
            .collect::<Vec<_>>();

        UpdatedWorkspaceFiles {
            file_map: FileMap {
                project_file_map: project_files_map.clone(),
                non_project_files: non_project_files.clone(),
            },
            external_references: NxWorkspaceFilesExternals {
                project_files: External::new(project_files_map),
                global_files: External::new(non_project_files),
                all_workspace_files: External::new(self.all_file_data()),
            },
        }
    }

    #[napi]
    pub fn all_file_data(&self) -> Vec<FileData> {
        let raw_files = self.files_worker.get_raw_files();
        let mut file_data = Vec::new();

        // Add workspace files
        for (path, hash) in &raw_files.workspace_files {
            file_data.push(FileData {
                file: path.to_normalized_string(),
                hash: hash.clone(),
            });
        }

        // Add additional root files
        for root_files in raw_files.additional_root_files.values() {
            for (path, hash) in root_files {
                file_data.push(FileData {
                    file: path.to_normalized_string(),
                    hash: hash.clone(),
                });
            }
        }

        file_data
    }

    #[napi]
    pub fn get_files_in_directory(&self, directory: String) -> Vec<String> {
        get_child_files(directory, self.all_file_data())
    }
}

impl Drop for WorkspaceContext {
    fn drop(&mut self) {
        let fw = mem::take(&mut self.files_worker);
        drop(fw);
    }
}
