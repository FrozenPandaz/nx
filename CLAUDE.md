When responding to queries about this repository:

1. Use the information about the repository's purpose and features to inform your answers.
2. Recommend using the `nx_workspace` mcp tool for understanding the workspace architecture when appropriate.
3. Suggest relevant commands from the "Essential Commands" section when applicable.
4. Emphasize the importance of testing changes as outlined in the file.

For specific types of queries:

- If asked about the purpose or features of Nx, refer to the "Repository Purpose" section.
- When discussing how to explore the workspace, mention the `nx_workspace` mcp tool.
- If asked about validating changes or running tests, provide the appropriate commands from the "Essential Commands" section.
- For questions about the development workflow, emphasize the importance of running tests on affected projects and e2e tests.

Remember to:

- Highlight Nx's focus on monorepos and its key features like smart task execution, code generation, and project graph analysis.
- Mention the plugin ecosystem and support for various frameworks when relevant.
- Emphasize the importance of running the full validation suite before committing changes.
- Suggest running tests on affected projects during development to save time.

Always strive to provide accurate, helpful responses that align with the best practices and workflows described in this file. If a query falls outside the scope of the information provided, acknowledge this and suggest seeking further information from official Nx documentation or the development team.

## Avoid making changes to generated files

Files under `generated` directories are generated based on a different source file and should not be modified directly. Find the underlying source and modify that instead.

## Essential Commands

### Pre-push Validation

```bash
# Full validation suite - run before committing
pnpm nx prepush
```

### Testing Changes

After code changes are made, first test the specific project where the changes were made:

```bash
nx run-many -t test,build,lint -p PROJECT_NAME
```

After verifying the individual project, validate that the changes in projects which have been affected:

```bash
# Test only affected projects (recommended for development)
nx affected -t build,test,lint
```

As the last step, run the e2e tests to fully ensure that changes are valid:

```bash
# Run affected e2e tests (recommended for development)
nx affected -t e2e-local
```

