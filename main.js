/*
#  DDNSToken
#  main.js
#
#  Copyright © 2023 Certchip Corp. All rights reserved.
#  Created by GYUYOUNG KANG on 2023/04/15.
#
*/


const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { shell } = require('electron')
const { globalShortcut, clipboard } = require('electron');

// npm install adm-zip
const AdmZip = require('adm-zip');

// npm install serialport
const { SerialPort } = require('serialport');

process.env.NODE_ENV = '!production';

const isDev = process.env.NODE_ENV !== 'production';
const isMac = process.platform === 'darwin';

var mainWindow, aboutWindow;
var serialPort = null;
var writePort = null;
var fileTransferMode = false;
var skipPythonLog = true;
var pasteModeAction = null;

// 렌더러로 부터 메시지를 수신한 것이다.
ipcMain.on("toMain", (event, data) => {
    fromRenderer(data);
});

const sleep = (ms) => {
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    })
}

function copyToClipboard(content) {
    clipboard.writeText(content);
}

function deleteDirectory(directoryPath) {
    // 디렉토리 안의 파일 목록 가져오기
    fs.readdir(directoryPath, (err, files) => {
        if (err) throw err;

        // 모든 파일 삭제
        files.forEach((file) => {
            const filePath = path.join(directoryPath, file);
            fs.unlink(filePath, (err) => {
                if (err) throw err;
            });
        });

        // 디렉토리 삭제
        fs.rmdir(directoryPath, (err) => {
            if (err) throw err;
            //console.log(`Successfully deleted directory: ${directoryPath}`);
        });
    });
}
function deleteDirectorySync(directoryPath) {
    // 디렉토리 안의 파일 목록 가져오기
    const files = fs.readdirSync(directoryPath);
  
    // 모든 파일 삭제
    files.forEach((file) => {
        const filePath = path.join(directoryPath, file);
        fs.unlinkSync(filePath);
    });
  
    // 디렉토리 삭제
    fs.rmdirSync(directoryPath);
    //console.log(`Successfully deleted directory: ${directoryPath}`);
}
function deleteFolderRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach(function(file) {
        const curPath = path.join(dirPath, file);
        if (fs.lstatSync(curPath).isDirectory()) { // recursive
            deleteFolderRecursive(curPath);
        } else { // delete file
            fs.unlinkSync(curPath);
        }
        });
        fs.rmdirSync(dirPath);
    }
}
function isFile(path) {
    try {
      const stat = fs.lstatSync(path);
      return stat.isFile();
    } catch (err) {
      return false;
    }
}
function createPaddedString(c, length) {
    return c.repeat(length).slice(0, length);
}  

function isPythonLog(str) {
    return (str.startsWith(">>>") 
        || str.indexOf("MicroPython")>=0 
        || str.indexOf("Traceback (")>=0 
        || str.indexOf("File \"")>=0 
        || str.indexOf("import ")>=0 
        || str.indexOf("KeyboardInterrupt:")>=0 
        || str.indexOf("Type \"help()\"")>=0);
}

async function sendToFileData(file, data) {    
    fileTransferMode = true;

    await cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
    await cmdToSerialPort("\x03");   // Ctrl+C => Stop
    await cmdToSerialPort("\x03");   // Ctrl+C => Stop
    await sleep(300);
    await sendToSerialPortSync(`file = open('${file}', 'w')`);
    await sleep(100);
    
    const lines = data.split("\n");
    var count = 0;
    for( let line of lines) {
        await sendToSerialPortSync(`file.write('${line.replaceAll('\"', '\\"')}\\n')`);
        await sleep(10);
        count++;
        let per = parseInt((count / lines.length) * 100);
        toRenderer({cmd: 'per', data: per})
    }
    await sendToSerialPortSync("file.close()");
    await sendToSerialPortSync("");

    await sleep(100);

    fileTransferMode = false;
}
const sendToFileDataSync = (file, data) => {
    return new Promise(resolve => {
        sendToFileData(file, data).then(()=>{
            resolve();
        });
    })
}

const sendFileList = [];
function sendFileData(finish) {
    if (sendFileList.length==0) {
        if (finish) finish();
        return;
    }
    const sendFile = sendFileList.pop();
    if (sendFile) {
        const sendData = fs.readFileSync(sendFile);
        if (sendData) {
            const fileName = path.basename(sendFile);
            toRenderer({cmd: 'log', data: createPaddedString(".", sendFileList.length + 1)});
            sendToFileDataSync(fileName, sendData.toString('utf-8')).then(() => {
                setTimeout(() => {
                    sendFileData(finish);
                }, 100);
            });
        }
    }
}

function pasteMode(action) {
    globalShortcut.unregisterAll();

    pasteModeAction = action;
    if (pasteModeAction) {
        // Ctrl+V 키 조합 등록
        globalShortcut.register('CommandOrControl+V', () => {
            // 클립보드에서 텍스트 가져오기
            const text = clipboard.readText();
            toRenderer({cmd: 'paste', action: pasteModeAction, text: text});
        });        
    }
}


async function apiProcess(data) {
    console.log("apiProcess", data);
    await sleep(10);
    
    if (data.cmd==='openweb') {
        shell.openExternal(data.url);
    } else
    if (data.cmd==='start') {
        cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        cmdToSerialPort("\x04");   // Ctrl+D => Soft Reboot
    } else
    if (data.cmd==='stop') {
        cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
    } else
    if (data.cmd==='copy') {
        copyToClipboard(data.data);
    } else
    if (data.cmd==='paste') {
        pasteMode(data.action);
    } else
    if (data.cmd==='factory-reset') {
        cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        await sleep(300);
        sendToSerialPort("import ddnstoken_misc");
        sendToSerialPort("ddnstoken_misc.factory_clear()");
        setTimeout(()=>{
            cmdToSerialPort("\x04");   // Ctrl+D => Start
        }, 10);
    } else
    if (data.cmd==='soft-reset') {
        cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        await sleep(300);
        sendToSerialPort("import ddnstoken_misc");
        sendToSerialPort("ddnstoken_misc.soft_reset()");
        setTimeout(()=>{
            serialPort = null;
            toRenderer({cmd: 'reconnect'});
        }, 1000);
    } else
    if (data.cmd==='wifi') {
        const ssid = data.ssid;
        const pass = data.pass;
        if (ssid && pass) {
            cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
            cmdToSerialPort("\x03");   // Ctrl+C => Stop
            cmdToSerialPort("\x03");   // Ctrl+C => Stop
            await sleep(300);

            sendToSerialPort("import ddnstoken_misc");
            sendToSerialPort("ddnstoken_misc.set_wifi('"+ssid+"','"+pass+"')");
            sendToSerialPort("ddnstoken_misc.soft_reset()");

            setTimeout(() => {
                // 와이파이 셋팅 이후에는 ...
                // 장치를 리셋 해줘야 정상 동작 한다.
                serialPort = null;
                toRenderer({cmd: 'reconnect'});
            }, 1000);    
        } else {
            cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
            cmdToSerialPort("\x03");   // Ctrl+C => Stop
            await sleep(300);
            sendToSerialPort("import ddnstoken_misc");
            sendToSerialPort("print(ddnstoken_misc.get_wifi())");    
        }
    } else
    if (data.cmd==='update') {
        dialog.showOpenDialog({
            filters: [{ name: 'Firmware Module', extensions: ['fwm'] }, { name: 'Zipped Python File', extensions: ['zpy'] }, { name: 'Python File', extensions: ['py'] }, { name: 'Json File', extensions: ['json'] }],
            properties: ['openFile']
          }).then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                sendFileList.length = 0;

                const filepath = result.filePaths[0];

                const fileName = path.basename(filepath);
                const extName = path.extname(filepath).toLowerCase();
                if (extName === ".fwm" || extName === ".py" || extName === ".json") {
                    toRenderer({cmd: 'log', data: `File send : ${fileName}`});
                    if (extName === ".fwm") {
                        fs.readFile(filepath, 'utf-8', (err, data) => {
                            if (!err) {
                                const decodedData = Buffer.from(data, 'base64');
                                if (decodedData) {
                                    const tempDir = os.tmpdir();
                                    const newDir = path.join(tempDir, 'ddnstoken.fwm');
                                    if (fs.existsSync(newDir)) {
                                        deleteFolderRecursive(newDir);
                                    }
                                    if (!fs.existsSync(newDir)) {
                                        fs.mkdirSync(newDir);
                                    }

                                    const zip = new AdmZip(decodedData);
                                    zip.extractAllTo(newDir, true);

                                    const files = fs.readdirSync(newDir);  
                                    var fcount = 0;
                                    files.forEach((file) => {
                                        if (fcount < 32) {
                                            const newFile = path.join(newDir, file);
                                            if (isFile(newFile)) {
                                                sendFileList.push(newFile);
                                            }
                                        }
                                    });
                                    if (sendFileList.length > 0) {
                                        setTimeout(() => {
                                            sendFileData(() => {
                                                if (fs.existsSync(newDir)) {
                                                    console.log(newDir);
                                                    deleteFolderRecursive(newDir);
                                                    toRenderer({cmd: 'log', data: `OK`});
                                                    toRenderer({cmd: 'log', data: ``});
                                                    setTimeout(() => {
                                                        toRenderer({cmd: 'log', data: '\n##### Caution #####\nIf you have updated the firmware,\nyou can check the updated firmware version\nafter rebooting.\n\n'});
                                                        cmdToSerialPort("\x04");   // Ctrl+D => Start
                                                    }, 3000);
                                                }            
                                            })
                                        }, 100);
                                    }
                                }
                            } else {
                                console.log(err);
                            }
                        });
                    } else
                    if (extName === ".py" || extName === ".json") {
                        fs.readFile(filepath, 'utf-8', async (err, data) => {
                            if (!err) {
                                sendToFileDataSync(fileName, data).then(() => {
                                    toRenderer({cmd: 'log', data: `OK`});
                                    toRenderer({cmd: 'log', data: ``});
                                    setTimeout(() => {
                                        cmdToSerialPort("\x04");   // Ctrl+D => Start
                                    }, 300);                            
                                });
                            } else {
                                console.log(err);
                            }
                        });    
                    }
                }
            }
          }).catch(err => {
            console.log(err);
          });        
    } else
    if (data.cmd==='version') {
        cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        await sleep(300);
        sendToSerialPort("import ddnstoken_misc");
        sendToSerialPort("print(ddnstoken_misc.get_version())");

        setTimeout(() => {
            toRenderer({cmd: 'log', data: 'OK\n\n##### Caution #####\nA reboot is required after checking the version\nto run the device.\n\n'});
            cmdToSerialPort("\x04");   // Ctrl+D => Start
        }, 3000);
    } else
    if (data.cmd==='ddns') {
        if (data.data) {
            if (data.data.ddns==="duckdns" || data.data.ddns==="cloudflare" || data.data.ddns==="freemyip") {
                const ddns = data.data.ddns;
                const name = data.data.name;
                const domain = data.data.domain;
                const token = data.data.token;
                const interval = data.data.interval;

                cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
                cmdToSerialPort("\x03");   // Ctrl+C => Stop
                await sleep(300);
                sendToSerialPort("import ddnstoken_misc");
                sendToSerialPort("print(ddnstoken_misc.set_ddns_service('"+ddns+"', '"+name+"', '"+domain+"', '"+token+"', "+interval+"))");
            } else
            if (data.data.ddns==="freedns") {
                const ddns = data.data.ddns;
                const name = data.data.name;
                const token = data.data.token;
                const interval = data.data.interval;

                cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
                cmdToSerialPort("\x03");   // Ctrl+C => Stop
                await sleep(300);
                sendToSerialPort("import ddnstoken_misc");
                sendToSerialPort("print(ddnstoken_misc.set_ddns_service_1('"+ddns+"', '"+name+"', '"+token+"', "+interval+"))");
            } else
            if (data.data.ddns==="google" || data.data.ddns==="noip") {
                const ddns = data.data.ddns;
                const name = data.data.name;
                const hostname = data.data.hostname;
                const username = data.data.username;
                const password = data.data.password;
                const interval = data.data.interval;

                cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
                cmdToSerialPort("\x03");   // Ctrl+C => Stop
                await sleep(300);
                sendToSerialPort("import ddnstoken_misc");
                sendToSerialPort("print(ddnstoken_misc.set_ddns_service_2('"+ddns+"', '"+name+"', '"+hostname+"', '"+username+"', '"+password+"', "+interval+"))");
            } else
            if (data.data.ddns==="cloudns") {
                const ddns = data.data.ddns;
                const name = data.data.name;
                const qstring = data.data.qstring;
                const interval = data.data.interval;

                cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
                cmdToSerialPort("\x03");   // Ctrl+C => Stop
                await sleep(300);
                sendToSerialPort("import ddnstoken_misc");
                sendToSerialPort("print(ddnstoken_misc.set_ddns_service_3('"+ddns+"', '"+name+"', '"+qstring+"', "+interval+"))");
            } else
            if (data.data.ddns==="godaddy" || data.data.ddns==="dyndns") {
                const ddns = data.data.ddns;
                const name = data.data.name;
                const domain = data.data.domain;
                const record = data.data.record;
                const apikey = data.data.apikey;
                const apisecret = data.data.apisecret;
                const interval = data.data.interval;

                cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
                cmdToSerialPort("\x03");   // Ctrl+C => Stop
                await sleep(300);
                sendToSerialPort("import ddnstoken_misc");
                sendToSerialPort("print(ddnstoken_misc.set_ddns_service_4('"+ddns+"', '"+name+"', '"+domain+"', '"+record+"', '"+apikey+"', '"+apisecret+"', "+interval+"))");
            }
        } else {
            await ddnsService();
        }
    } else
    if (data.cmd==='reboot') {        
        cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
        cmdToSerialPort("\x03");   // Ctrl+C => Stop
        cmdToSerialPort("\x04");   // Ctrl+D => Soft Reboot
    } else
    if (data.cmd==='scan') {
        console.log(">>> scan", data.device);
        if (data.device==='serial-port') {
            scanSerialPort();
        }
    } else
    if (data.cmd==='connect') {
        if (serialPort) {
            console.log(">>> disconnect");
            serialPort.close(function (err) {
                if (err==null) { 
                    serialPort = null;
                    console.log('>> port disconnected');
                    toRenderer({cmd: 'port-status', status: 'disconnected'});
                } else {
                    serialPort = null;
                    console.log('>> port error');
                    toRenderer({cmd: 'port-status', status: 'error'});
                }
            });
        } else {
            const device = data.device;
            if (device) {
                console.log(`>>> connect ${device}`);
    
                // 시리얼 포트 연결 설정
                serialPort = new SerialPort({ 
                    path: device, 
                    baudRate: 115200
                }, (err) => {
                    if (err==null) {
                        console.log('>> port connected');
                        toRenderer({cmd: 'port-status', status: 'connected'});    
                    } else {
                        serialPort.close();
                        serialPort = null;
                        writePort = null;
                        console.log('>> port connect error', err);
                        toRenderer({cmd: 'port-status', status: 'error'});
                        toRenderer({cmd: 'err', data: err.message});
                        toRenderer({cmd: 'err', data: " "});

                        if (err.message && err.message.indexOf("Permission") >= 0) {
                            toRenderer({cmd: 'err', data: `The current user's privileges may not allow port access.`});
                            toRenderer({cmd: 'err', data: `Please give permission to the account with the following`});
                            toRenderer({cmd: 'err', data: `Linux command, reboot the computer, and try again.`});
    
                            const userInfo = os.userInfo();                        
                            toRenderer({cmd: 'err', data: `---------------------------------------------------`});
                            toRenderer({cmd: 'err', data: `$ sudo usermod -a -G dialout ${userInfo.username}`});
                            toRenderer({cmd: 'err', data: `$ sudo reboot`});
                            toRenderer({cmd: 'err', data: `---------------------------------------------------`});

                            // sudo gpasswd -d gcc dialout    
                        }

                    }
                });

                writePort = util.promisify(serialPort.write.bind(serialPort));

                // Open errors will be emitted as an error event
                serialPort.on('error', function(err) {
                    console.log('Error: ', err.message)
                });
                // Read data that is available but keep the stream in "paused mode"
                /*
                serialPort.on('readable', function () {
                    let str = String(serialPort.read()).trim();
                    if (str.length > 0) {
                        console.log('Data:', str)
                        toRenderer({cmd: 'log', data: str});
                    }
                })
                */
                // Switches the port into "flowing mode"
                var rBuff = "";
                var rTimer = -1;
                serialPort.on('data', function (data) {
                    if (rTimer>=0) {
                        clearTimeout(rTimer);
                        rTimer = -1;
                    }
                    if (fileTransferMode) {
                        rBuff = "";
                    } else {
                        rBuff += String(data);
                        if (rBuff.endsWith("\n")) {
                            var rr = rBuff.split("\n");
                            if (rr.length>0) {
                                for (var r of rr) {
                                    let str = r.trim();
                                    if (str.length > 0) {
                                        if (!skipPythonLog || !isPythonLog(str)) {
                                            procLog(str);
                                        }
                                    }    
                                }
                                rBuff = "";    
                            }    
                        } else {
                            // 일정 시간동안 데이터 수신이 없다면 현재 버퍼를 처리한다.
                            const bTimer = setTimeout(() => {
                                if (rTimer == bTimer) {
                                    rTimer = -1;
                                    var rr = rBuff.split("\n");
                                    if (rr.length>0) {
                                        for (var r of rr) {
                                            let str = r.trim();
                                            if (str.length > 0) {
                                                if (!skipPythonLog || !isPythonLog(str)) {
                                                    procLog(str);
                                                }
                                            }    
                                        }
                                        rBuff = "";    
                                    }    
                                }
                            }, 100);
                            rTimer = bTimer;
                        }
                    }
                });
            }    
        }
    }
}

function procLog(data) {
    toRenderer({cmd: 'log', data: data});
    if (data.indexOf("WIFISSID")>0 && data.indexOf("WIFIPASS")>0) {
        toRenderer({cmd: 'wifi', data: data});
    } else
    if (data.indexOf("DDNS")>0 && data.indexOf("DDNS_LIST")>0) {
        toRenderer({cmd: 'ddns', data: data});
    }
}

async function ddnsService() {
    cmdToSerialPort("\x02");   // Ctrl+B => Exit REPL 
    cmdToSerialPort("\x03");   // Ctrl+C => Stop
    await sleep(300);

    sendToSerialPort("import ddnstoken_misc");
    sendToSerialPort("print(ddnstoken_misc.get_ddns_service_info())");

    setTimeout(() => {
        cmdToSerialPort("\x04");   // Ctrl+D => Start
    }, 1000);
}

// 렌더러로 부터 온 메시지를 처리한다.
function fromRenderer(data) {
    if ( typeof data === 'object' ) {
        //console.log(`Received [${JSON.stringify(data)}] from renderer process`);  
        apiProcess(data);      
    } else {
        console.log(`Received [${data}] from renderer process`);
    }
}
// 렌더러로 메시지를 보낸다.
function toRenderer(data) {
    mainWindow.webContents.send("fromMain", data);
}

// Create the main window
function createMainWindow() {
    let icon;
    switch (process.platform) {
        case 'win32': icon = path.join(__dirname, './assets/icons/win', 'icon.ico'); break;
        case 'darwin': icon = path.join(__dirname, './assets/icons/mac', 'icon.icns'); break;
        case 'linux': icon = path.join(__dirname, './assets/icons/linux', 'icon.png'); break;
    }

    // console.log(icon);
    
    mainWindow = new BrowserWindow({
        title: 'DDNSToken Setup',
        width: isDev ? 1000 : 640,
        backgroundColor: '#ffffff',
        height: 680,
        webPreferences: {
            nodeIntegration: true,     // is default value after Electron v5
            contextIsolation: true,     // protect against prototype pollution
            enableRemoteModule: false,  // turn off remote
            nativeWindowOpen: true,
            worldSafeExecuteJavaScript: true,
            webviewTag: true,
            preload: path.join(__dirname, 'preload.js')
        },
        frame: true,
        //show: true, // hidden the windown before loaded
        icon: icon
    });

    // Show the main window when page is loaded
    //mainWindow.once('ready-to-show', () => {
    //    mainWindow.show();
    //});    

    // 변수 값을 HTML에 적용
    mainWindow.webContents.on('did-finish-load', () => {
       // mainWindow.webContents.executeJavaScript(`document.getElementById('app-name').textContent = '${app.name}';`);
       toRenderer({ cmd: 'set-appname', name: `${app.name}` });
       scanSerialPort();
    });    

    // Open devtools if in dev env
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.loadFile(path.join(__dirname, './app/main.html'));
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// About Window
function createAboutWindow() {
    aboutWindow = new BrowserWindow({
        width: 300,
        height: 300,
        title: 'About Electron',
        icon: `${__dirname}/assets/icons/Icon-256.png`,
    });  
    aboutWindow.loadFile(path.join(__dirname, './app/about.html'));

    aboutWindow.on('closed', () => {
        aboutWindow = null;
    });
}

function scanSerialPort() {
    // 시리얼 포트 검색
    SerialPort.list().then((ports) => {
        toRenderer({cmd: 'clear-port'});
        ports.forEach((port) => {
            // console.log(JSON.stringify(port));
            // Windows 11 Pro, "vendorId":"2E8A","productId":"0005"
            var manufacturer = port.manufacturer;
            var vendorId = port.vendorId;
            var productId = port.productId;
            if (manufacturer || (vendorId && productId)) {
                if (vendorId) vendorId = vendorId.toUpperCase();
                if (productId) productId = productId.toUpperCase();
                if (manufacturer) console.log("manufacturer:", manufacturer);
                if (vendorId) console.log("vendorId:", vendorId);
                if (productId) console.log("productId:", productId);
                if (manufacturer==="MicroPython" || (vendorId==="2E8A" && productId==="0005")) {
                    toRenderer({cmd:'add-port', port: port});
                }    
            }
        });
    });
}


async function cmdToSerialPort(cmd) {
    if (serialPort) {
        try {
            await writePort(cmd);
        } catch (error) {        
            console.log('Error on cmdToSerialPort: ', error.message)
        }
        /*
        await serialPort.write(`${cmd}`, function(err) {
            if (err) {
                console.log('Error on write: ', err.message)
            } else {
                //console.log(`message written ${cmd}\n`)
            }
        });
        */
    }
}
async function sendToSerialPort(data) {
    if (serialPort) {
        try {
            await writePort(`${data}\r\n`);
        } catch (error) {        
            console.log('Error on sendToSerialPort: ', error.message)
        }
        /*
        await serialPort.write(`${data}\r\n`, function(err) {
            if (err) {
                console.log('Error on write: ', err.message)
            } else {
                //console.log(`message send ${data}\n`)
            }
        });
        */
    }
}

const sendToSerialPortSync = (data) => {
    return new Promise(resolve => {
        sendToSerialPort(data).then(()=>{
            resolve();
        });
    })
}


// serialPort.write('main screen turn on\n', function(err) {
//     if (err) {
//       return console.log('Error on write: ', err.message)
//     }
//     console.log('message written')
// });
  


  
// App is ready
app.whenReady().then(() => {
    createMainWindow();

    // Implement menu
    const mainMenu = Menu.buildFromTemplate(menu);
    Menu.setApplicationMenu(mainMenu);

    app.on('activate', () => {
        if (mainWindow==null || BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// Menu template
const menu = [
    ...(isMac
        ? [
            {
            label: app.name,
            submenu: [
                {
                    label: 'About',
                    click: createAboutWindow,
                },
            ],
            },
        ]
        : []),
    {
        role: 'fileMenu',
    },
    ...(!isMac
        ? [
            {
                label: 'Help',
                submenu: [
                    {
                        label: 'About',
                        click: createAboutWindow,
                    },
                ],
            },
        ]
        : []),
    // {
    //   label: 'File',
    //   submenu: [
    //     {
    //       label: 'Quit',
    //       click: () => app.quit(),
    //       accelerator: 'CmdOrCtrl+W',
    //     },
    //   ],
    // },
    ...(isDev
        ? [
            {
                label: 'Developer',
                submenu: [
                    { role: 'reload' },
                    { role: 'forcereload' },
                    { type: 'separator' },
                    { role: 'toggledevtools' },
                ],
            },
        ]
        : []),
];
  
app.on('window-all-closed', () => {
    if (!isMac) {
      app.quit()
    }
})


