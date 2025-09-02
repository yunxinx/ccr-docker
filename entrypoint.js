#!/usr/bin/env node

const { spawn } = require('child_process');
const { existsSync, mkdirSync, readdirSync, statSync, readFileSync, createReadStream, unlinkSync } = require('fs');  // 新增unlinkSync导入
const path = require('path');

// --- 配置定义 ---
const CONFIG_FILE = "/root/.claude-code-router/config.json";
const LOGS_DIR = "/root/.claude-code-router/logs";
const CCR_CLI_PATH = "/app/node_modules/@musistudio/claude-code-router/dist/cli.js";
const PID_FILE = "/root/.claude-code-router/.claude-code-router.pid";  // 新增PID文件路径定义

// --- 优雅退出处理 ---
let ccrProcess = null;
let logInterval = null;

function cleanup() {
    console.log('--> Received stop signal. Cleaning up background processes...');
    if (logInterval) clearInterval(logInterval);
    if (ccrProcess) {
        ccrProcess.kill('SIGTERM');
        // 增加 SIGKILL 后备，确保进程最终退出
        setTimeout(() => {
            if (ccrProcess && !ccrProcess.killed) {
                ccrProcess.kill('SIGKILL');
            }
        }, 5000); // 5秒后强制杀死
    }
    setTimeout(() => {
        console.log('--> Cleanup complete. Exiting.');
        process.exit(0);
    }, 200);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGQUIT', cleanup);

// --- 安全的 stdout 写入 (解决背压问题) ---
function writeToStdoutSafely(data) {
    try {
        const success = process.stdout.write(data);
        if (!success) {
            process.stdout.once('drain', () => {}); // 等待缓冲区清空
        }
    } catch (err) {
        // 忽略 EPIPE (管道破裂) 和 EAGAIN (资源暂时不可用) 错误
        if (err.code !== 'EPIPE' && err.code !== 'EAGAIN') {
            console.error('Write error (ignored):', err.message);
        }
    }
}

// --- 环境检查 ---
function checkEnvironment() {
    if (!existsSync(CCR_CLI_PATH)) {
        console.error(`错误：CCR CLI 文件未找到: ${CCR_CLI_PATH}`); 
        process.exit(1);
    }
    if (!existsSync(CONFIG_FILE)) {
        console.error('---');
        console.error('错误：配置文件未找到！');
        console.error(`请挂载配置文件到: -v /path/to/your/config.json:${CONFIG_FILE}`);
        console.error('---');
        process.exit(1);
    }
    try {
        mkdirSync(LOGS_DIR, { recursive: true });
    } catch (err) {
        console.error(`错误：无法创建日志目录: ${err.message}`); 
        process.exit(1);
    }
}

// --- 删除PID文件 ---
function deletePidFile() {
    if (existsSync(PID_FILE)) {
        try {
            unlinkSync(PID_FILE);
            console.log(`--> 已删除旧的PID文件: ${PID_FILE}`);
        } catch (err) {
            console.warn(`--> 警告：删除PID文件失败: ${err.message}`);
            // 这里不退出，因为PID文件删除失败不应该阻止服务启动
        }
    } else {
        console.log(`--> 未找到PID文件: ${PID_FILE}，无需删除`);
    }
}

// --- 查找最新日志文件 ---
function findLatestLogFile() {
    try {
        if (!existsSync(LOGS_DIR)) return null;
        const files = readdirSync(LOGS_DIR)
            .filter(name => name.startsWith('ccr-') && name.endsWith('.log'))
            .map(name => ({ 
                path: path.join(LOGS_DIR, name), 
                mtime: statSync(path.join(LOGS_DIR, name)).mtime 
            }))
            .sort((a, b) => b.mtime - a.mtime);
        return files.length > 0 ? files[0].path : null;
    } catch (err) {
        return null;
    }
}

// --- 日志跟踪功能 ---
function startLogTailing(logFilePath) {
    let position = 0;
    let isReading = false;
    
    if (process.env.SHOW_EXISTING_LOGS !== 'false') {
        try {
            const existingContent = readFileSync(logFilePath, 'utf8');
            if (existingContent) {
                writeToStdoutSafely(existingContent);
                position = Buffer.byteLength(existingContent, 'utf8');
            }
        } catch (err) { /* 忽略错误 */ }
    } else {
        try {
            position = statSync(logFilePath).size;
        } catch (err) { /* 忽略错误 */ }
    }

    logInterval = setInterval(() => {
        if (isReading) return;
        try {
            const stats = statSync(logFilePath);
            if (stats.size > position) {
                isReading = true;
                const stream = createReadStream(logFilePath, { 
                    start: position, 
                    encoding: 'utf8',
                    highWaterMark: 1024 * 16
                });
                stream.on('data', (chunk) => writeToStdoutSafely(chunk));
                stream.on('end', () => { 
                    position = stats.size; 
                    isReading = false; 
                });
                stream.on('error', () => { 
                    isReading = false; 
                });
            }
        } catch (err) { 
            isReading = false; 
        }
    }, 1000);
}

// --- 核心启动逻辑 ---
function startWithLogStreaming() {
    console.log('--> Log streaming is ENABLED.');
    
    // 使用 pipe 避免重复日志
    ccrProcess = spawn('node', [CCR_CLI_PATH, 'start'], {
        stdio: ['inherit', 'pipe', 'pipe']
    });

    // 静默消费 stdout 数据，防止管道阻塞
    ccrProcess.stdout.on('data', (data) => {
        // 日志的唯一来源是 startLogTailing
    });
    
    // stderr 可能包含重要错误，需要显示
    ccrProcess.stderr.on('data', (data) => {
        writeToStdoutSafely(data);
    });

    ccrProcess.on('error', (err) => { 
        console.error('错误：无法启动 ccr 命令:', err.message); 
        process.exit(1); 
    });
    
    ccrProcess.on('close', (code) => { 
        console.log(`CCR process exited with code ${code}`); 
        cleanup(); 
    });

    console.log('--> Waiting for the service to start and create a log file...');
    let pollCount = 0;
    const maxPolls = 20;
    
    const pollForLogFile = () => {
        if (!ccrProcess || ccrProcess.killed) { 
            console.error('错误：服务进程意外退出！'); 
            process.exit(1); 
        }
        const latestLogFile = findLatestLogFile();
        if (latestLogFile) {
            console.log(`--> Log file found: ${latestLogFile}`);
            startLogTailing(latestLogFile);
            return;
        }
        pollCount++;
        if (pollCount >= maxPolls) {
            console.error(`--> 错误：在 ${maxPolls} 秒内未找到日志文件。`);
            if (ccrProcess) ccrProcess.kill('SIGTERM');
            process.exit(1);
        }
        console.log(`--> Waiting for log file... (${pollCount}/${maxPolls})`);
        setTimeout(pollForLogFile, 1000);
    };
    setTimeout(pollForLogFile, 1000);
}

function startStandardMode() {
    console.log('--> Log streaming is DISABLED. Starting service in standard foreground mode.');
    ccrProcess = spawn('node', [CCR_CLI_PATH, 'start'], { stdio: 'inherit' });
    ccrProcess.on('error', (err) => { 
        console.error('错误：无法启动 ccr 命令:', err.message); 
        process.exit(1); 
    });
    ccrProcess.on('close', (code) => { 
        process.exit(code || 0); 
    });
}

function startCCR() {
    console.log('--> Service is starting...');
    console.log(`--> 日志将保存在 ${LOGS_DIR} 目录。`);
    console.log(`--> 建议挂载日志目录进行持久化: -v /path/to/your/logs:${LOGS_DIR}`);
    
    // 在启动服务前删除PID文件
    deletePidFile();
    
    if (process.env.STREAM_LOG_FILE === 'true') {
        startWithLogStreaming();
    } else {
        startStandardMode();
    }
}

// --- 主执行流程 ---
checkEnvironment();
startCCR();
