package dev.nx.gradle

import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.gradle.tooling.*
import org.gradle.tooling.events.OperationType
import org.gradle.tooling.events.ProgressEvent
import org.gradle.tooling.events.task.TaskFailureResult
import org.gradle.tooling.events.task.TaskFinishEvent
import org.gradle.tooling.events.task.TaskStartEvent
import org.gradle.tooling.events.task.TaskSuccessResult
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStreamReader
import java.nio.file.Files
import java.time.Duration
import java.time.Instant

data class NxBatchOptions(
    val workspaceRoot: String,
    val taskNames: List<String>,
    val additionalArgs: String,
    val outputFile: String,
    val ipc: Boolean = false
)

//fun main() = runBlocking {
//    val reader = BufferedReader(InputStreamReader(System.`in`))
//    println("Kotlin CLI started. Type your command (type 'exit' to quit):")
//    System.out.flush()
//
//    // Launch a coroutine on the IO dispatcher to read from stdin
//    val inputJob = launch(Dispatchers.IO) {
//        while (true) {
//            // Blocking call is confined to the IO dispatcher
//            val inputLine = reader.readLine() ?: break
//            if (inputLine.trim().equals("exit", ignoreCase = true)) {
//                println("Exiting Kotlin CLI...")
//                System.out.flush()
//                break
//            }
//            // Launch a new coroutine for each input to process concurrently.
//            launch {
//                processInput(inputLine)
//            }
//        }
//    }
//
//    // Wait for the input job to complete before ending main()
//    inputJob.join()
//
//    println("Done");
//    System.out.flush()
//}

//suspend fun processInput(input: String) {
//    println("Processing input: $input")
//    System.out.flush()
//
//    // Simulate an API call with a delay (replace this with your actual API call)
//    delay(1000)
//
//    println("API call complete for input: $input")
//    System.out.flush()
//}

fun main(args: Array<String>) = runBlocking {
    val options = parseArgs(args)

//    if (options.workspaceRoot.isBlank() || options.taskNames.isEmpty() || options.outputFile.isBlank()) {
//        println("❌ Missing required arguments --workspaceRoot and/or --tasks and/or --outputFile")
//        exitProcess(1)
//    }

    println("⚙️ Running NxBatchRunner")
    println("  Workspace: ${options.workspaceRoot}")
    println("  Tasks: ${options.taskNames}")
    println("  Extra Args: ${options.additionalArgs}")
    println("  Output: ${options.outputFile}")
    println("  IPC: ${options.ipc}")

    val startConnectTime = Instant.now()
    val connection = GradleConnector.newConnector()
        .forProjectDirectory(File(options.workspaceRoot))
        .connect()
    val endConnectTime = Instant.now()
    val connectionDuration = Duration.between(startConnectTime, endConnectTime).toMillis()
    println("⏱️ Gradle connection established in ${connectionDuration}ms")

    if (options.ipc) {
        connection.use { connection ->
            val results = runTasksWithProgressListener(connection, options.taskNames, options.additionalArgs)

            val reportFile = File(options.outputFile)
            reportFile.parentFile.mkdirs()

            val reportJson = Gson().toJson(results)
            Files.write(reportFile.toPath(), reportJson.toByteArray(Charsets.UTF_8))

            println("✅ Batch report written to: ${reportFile.absolutePath}")
        }
    } else {
        connection.use { connection ->

            val reader = BufferedReader(InputStreamReader(System.`in`))
            println("Kotlin CLI started. Type your command (type 'exit' to quit):")
            System.out.flush()

            // Launch a coroutine on the IO dispatcher to read from stdin
            val inputJob = launch(Dispatchers.IO) {
                while (true) {
                    // Blocking call is confined to the IO dispatcher
                    val inputLine = reader.readLine() ?: break
                    if (inputLine.trim().equals("exit", ignoreCase = true)) {
                        println("Exiting Kotlin CLI...")
                        System.out.flush()
                        break
                    }
                    // Launch a new coroutine for each input to process concurrently.
                    launch {
                        try {

                            processInput(connection, inputLine, options.outputFile)
                        } catch (e: Exception) {
                            println("❌ Error processing input: ${e.message}")
                        }
                    }
                }
            }

            // Wait for the input job to complete before ending main()
            inputJob.join()


//            val results = runTasksWithProgressListener2(connection, options.taskNames, options.additionalArgs)
//
//            val reportFile = File(options.outputFile)
//            reportFile.parentFile.mkdirs()
//
//            val reportJson = Gson().toJson(results)
//            Files.write(reportFile.toPath(), reportJson.toByteArray(Charsets.UTF_8))
//
//            println("✅ Batch report written to: ${reportFile.absolutePath}")
        }
    }
}

suspend fun processInput(connection: ProjectConnection, taskname: String, outputDir: String) {
//    println("Processing input: $taskname")
    System.out.flush()

    val results = runTasksWithProgressListener2(connection, listOf(taskname), "")

    val reportFile = File(outputDir, "$taskname.json")
    reportFile.parentFile.mkdirs()

    val reportJson = Gson().toJson(results)
    withContext(Dispatchers.IO) {
        Files.write(reportFile.toPath(), reportJson.toByteArray(Charsets.UTF_8))
    }

    val jsonString = Gson().toJson(
        mapOf(
            "task" to taskname,
            "path" to reportFile.absolutePath,
            "terminalOutput" to results[taskname]?.terminalOutput
        )
    )

    println(jsonString)

    // Simulate an API call with a delay (replace this with your actuarl API call)
//    delay(1000)
    System.out.flush()
}

fun parseArgs(args: Array<String>): NxBatchOptions {
    val argMap = args.mapNotNull {
        val split = it.split("=", limit = 2)
        if (split.size == 2) split[0] to split[1] else null
    }.toMap()

    return NxBatchOptions(
        workspaceRoot = argMap["--workspaceRoot"] ?: "",
        taskNames = argMap["--tasks"]?.split(",")?.map { it.trim() } ?: emptyList(),
        additionalArgs = argMap["--args"] ?: "",
        outputFile = argMap["--output"] ?: ""
    )
}

data class TaskResult(
    val task: String,
    val success: Boolean,
    val startTime: Long,
    val endTime: Long,
    val errorMessage: String? = null,
    var terminalOutput: String? = null
)

fun runTasksWithProgressListener2(
    connection: ProjectConnection,
    taskNames: List<String>,
    additionalArgs: String
): Map<String, TaskResult> {
//    println("▶️ Running tasks with progress listener: ${taskNames}")

    val buildLauncher: BuildLauncher = connection.newBuild()
    val launcher: ConfigurableLauncher<*> = buildLauncher

    val outputStream = ByteArrayOutputStream()

    val args = listOf("--continue", "--parallel") + additionalArgs
        .split(" ")
        .map { it.trim() }
        .filter { it.isNotEmpty() }

    buildLauncher.forTasks(*taskNames.toTypedArray())
    buildLauncher.withArguments(args)

    buildLauncher.setStandardOutput(outputStream)
    buildLauncher.setStandardError(outputStream)

    val taskStartTimes = mutableMapOf<String, Instant>()
    val taskResults = mutableMapOf<String, TaskResult>()

    buildLauncher.addProgressListener({ event: ProgressEvent ->
        when (event) {
            is TaskStartEvent -> {
//                println("🚀 Task started: ${event.descriptor.taskPath}")
                taskStartTimes[event.descriptor.taskPath] = Instant.now()
            }

            is TaskFinishEvent -> {
                val taskPath = event.descriptor.taskPath
                val startTime = taskStartTimes[taskPath] ?: Instant.now()
                val endTime = Instant.now()
                val duration = Duration.between(startTime, endTime).toMillis()

                val result = event.result
                val success: Boolean
                val errorMessage: String?

                when (result) {
                    is TaskSuccessResult -> {
                        success = true
                        errorMessage = null
//                        println("✅ Task finished successfully: $taskPath")
                    }

                    is TaskFailureResult -> {
                        success = false
                        errorMessage = result.failures.joinToString("\n") { it.message ?: "Unknown error" }
//                        println("❌ Task failed: $taskPath")
//                        println("   Failures: $errorMessage")
                    }

                    else -> {
                        success = true
                        errorMessage = "Unknown result type"
//                        println("⚠️ Task finished with unknown result: $taskPath")
                    }
                }


                taskResults[taskPath] = TaskResult(
                    task = taskPath,
                    success = success,
                    startTime = startTime.toEpochMilli(),
                    endTime = result.endTime,
                    errorMessage = errorMessage,
                )

//                println("⏱️ Task '$taskPath' duration: ${duration}ms")
            }
        }
    }, OperationType.TASK)

    val startTime = Instant.now()

    try {
        buildLauncher.run()
    } catch (ex: Exception) {
//        println("❌ Build failed: ${ex.message}")
    }

    val endTime = Instant.now()
    val duration = Duration.between(startTime, endTime).toMillis()
//    println("⏱️ Total build duration: ${duration}ms")

    taskResults.values.forEach {
        it.terminalOutput = outputStream.toString()
    }

    return taskResults
}

fun runTasksWithProgressListener(
    connection: ProjectConnection,
    taskNames: List<String>,
    additionalArgs: String
): Map<String, TaskResult> {
    println("▶️ Running tasks with progress listener: ${taskNames}")

    val buildLauncher: BuildLauncher = connection.newBuild()
    val launcher: ConfigurableLauncher<*> = buildLauncher

    val outputStream = ByteArrayOutputStream()
    val errorStream = ByteArrayOutputStream()

    val args = listOf("--continue", "--parallel") + additionalArgs
        .split(" ")
        .map { it.trim() }
        .filter { it.isNotEmpty() }

    buildLauncher.forTasks(*taskNames.toTypedArray())
    buildLauncher.withArguments(args)

    buildLauncher.setStandardOutput(outputStream)
    buildLauncher.setStandardError(errorStream)

    val taskStartTimes = mutableMapOf<String, Instant>()
    val taskResults = mutableMapOf<String, TaskResult>()

    buildLauncher.addProgressListener({ event: ProgressEvent ->
        when (event) {
            is TaskStartEvent -> {
                println("🚀 Task started: ${event.descriptor.taskPath}")
                taskStartTimes[event.descriptor.taskPath] = Instant.now()
            }

            is TaskFinishEvent -> {
                val taskPath = event.descriptor.taskPath
                val startTime = taskStartTimes[taskPath] ?: Instant.now()
                val endTime = Instant.now()
                val duration = Duration.between(startTime, endTime).toMillis()

                val result = event.result
                val success: Boolean
                val errorMessage: String?

                when (result) {
                    is TaskSuccessResult -> {
                        success = true
                        errorMessage = null
                        println("✅ Task finished successfully: $taskPath")
                    }

                    is TaskFailureResult -> {
                        success = false
                        errorMessage = result.failures.joinToString("\n") { it.message ?: "Unknown error" }
                        println("❌ Task failed: $taskPath")
                        println("   Failures: $errorMessage")
                    }

                    else -> {
                        success = true
                        errorMessage = "Unknown result type"
                        println("⚠️ Task finished with unknown result: $taskPath")
                    }
                }

                val globalOutput = buildTerminalOutput(outputStream, errorStream)
                println(taskPath)
                println(globalOutput)
                println()
                val terminalOutput = extractTaskOutput(taskPath, globalOutput, success)

                taskResults[taskPath] = TaskResult(
                    task = taskPath,
                    success = success,
                    startTime = startTime.toEpochMilli(),
                    endTime = result.endTime,
                    errorMessage = errorMessage,
                    terminalOutput = terminalOutput
                )

                println("⏱️ Task '$taskPath' duration: ${duration}ms")
            }
        }
    }, OperationType.TASK)

    val startTime = Instant.now()

    val resultHandler = object : ResultHandler<Void> {
        override fun onComplete(result: Void?) {
            val endTime = Instant.now()
            val duration = Duration.between(startTime, endTime).toMillis()
            println("✅ Build completed in ${duration}ms")
            println(result)
        }

        override fun onFailure(t: GradleConnectionException) {
            val endTime = Instant.now()
            val duration = Duration.between(startTime, endTime).toMillis()
            println("❌ Build failed in ${duration}ms")
            println("Error: ${t.message}")
            t.printStackTrace()
        }
    }

    try {
        buildLauncher.run(resultHandler)
    } catch (ex: Exception) {
        println("❌ Build failed: ${ex.message}")
    }

    val endTime = Instant.now()
    val duration = Duration.between(startTime, endTime).toMillis()
    println("⏱️ Total build duration: ${duration}ms")
    val globalOutput = buildTerminalOutput(outputStream, errorStream)
    println(globalOutput)

    taskResults.values.forEach {
        it.terminalOutput = extractTaskOutput(it.task, globalOutput, it.success)
    }

    return taskResults
}

fun extractTaskOutput(taskName: String, globalOutput: String, success: Boolean): String {
    val lines = globalOutput.lines()
    val taskLinePrefix = "\u003e Task $taskName"

    val taskLineIndex = lines.indexOfFirst { it.trim().startsWith(taskLinePrefix) }

    return if (taskLineIndex != -1) {
        if (success) {
            // Include output up to the task line (inclusive)
            lines.subList(0, taskLineIndex + 1).joinToString("\n")
        } else {
            // Include everything from the task line to the end (error message included)
            lines.subList(taskLineIndex, lines.size).joinToString("\n")
        }
    } else {
        // If the task doesn't appear, include the full global output
        globalOutput
    }
}

fun buildTerminalOutput(stdOut: ByteArrayOutputStream, stdErr: ByteArrayOutputStream): String {
    val output = stdOut.toString("UTF-8")
    val errorOutput = stdErr.toString("UTF-8")

    val builder = StringBuilder()
    if (output.isNotBlank()) {
        builder.append("-- Standard Output --\n").append(output).append("\n")
    }
    if (errorOutput.isNotBlank()) {
        builder.append("-- Error Output --\n").append(errorOutput)
    }
    return builder.toString()
}
