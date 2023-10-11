import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as dgram from 'dgram';
import * as os from 'os';
import * as ip from 'ip';
import axios, { AxiosRequestConfig } from 'axios';


export function activate(context: vscode.ExtensionContext) {

	/* Start a session as the server of the session
	You will receive data from hosts actively to view their screens
	You will also be able to modify their code in real time */
	let startServerCommand = vscode.commands.registerCommand('csc.startCodeSharingServer', async () => {
		let networkInterfaces = os.networkInterfaces();
		let networkInterfaceNames = Object.keys(networkInterfaces);

		let chosenNetworkInterface: string | undefined = await vscode.window.showQuickPick(
			networkInterfaceNames,
			{
				"title": "Select a network interface for the server",
				"placeHolder": "eth0 (windows default) / en0 (macOS default)",
			}
		);

		if (chosenNetworkInterface !== undefined && chosenNetworkInterface !== '') {
			let ipv4Index = -1;
			networkInterfaces[chosenNetworkInterface]?.forEach((e, i) => {
				if(e.family === "IPv4") {
					ipv4Index = i;
				}
			});

			if(ipv4Index === -1) {
				vscode.window.showErrorMessage("CSC: No valid IPv4 address found on this interface. This extension only works with IPv4 for now!");
				return;
			}

			const host: string | undefined = networkInterfaces[chosenNetworkInterface]?.at(ipv4Index)?.address;
			const subnetMask : string | undefined = networkInterfaces[chosenNetworkInterface]?.at(ipv4Index)?.netmask;

			const broadcastAddr : string = ip.subnet(host || '', subnetMask || '').broadcastAddress;
			const port: number = 9898;

			const sessionID : string | undefined = await vscode.window.showInputBox(
				{
					"prompt": "Please enter a session name. (no special characters)",
				}
			);

			if(sessionID === undefined || sessionID === '') {
				vscode.window.showErrorMessage("CSC: Please enter a valid name for the session. (non-empty alphanumerical string)");
				return;
			}

			console.log(host, subnetMask, broadcastAddr);

			interface CursorPosition {
				[file: string]: {
					[key: string]: string
				}
			}

			let cursors: CursorPosition = {

			};

			const sock: dgram.Socket = dgram.createSocket('udp4');
			sock.bind(port);

			sock.on('listening', () => {
				sock.setBroadcast(true);

				setInterval(() => {
					sock.send("Code Sharing Server " + host + " " + sessionID, port, broadcastAddr);
				}, 1000);
			});

			/* requestListener listens for POST requests with a sessionID as a resource 
			and saves the files in a /tmp/ file for the teacher to see */
			let requestListener = (req: any, res: any): void => {
				if (req.method === "POST") {
					let file: string = '';
					let sessionID: string = path.dirname(req.url);
					let fileName: string = path.basename(req.url);

					req.on('data', (data: string) => {
						file += data;
					});

					req.on('end', () => {
						// eslint-disable-next-line @typescript-eslint/naming-convention
						const workSpacePath = vscode.workspace.workspaceFolders === undefined ? undefined : vscode.workspace.workspaceFolders[0].uri.fsPath;
						const filePath = workSpacePath + sessionID + "/" + fileName;

						fs.mkdir(workSpacePath + sessionID, (err) => console.log(err));
						fs.writeFile(filePath, file, (err) => console.log(err));

						const headers = JSON.parse(JSON.stringify(req.headers));
						cursors[fileName] = {
							"cursorselectionstartchar": headers["cursorselectionstartchar"],
							"cursorselectionstartline": headers["cursorselectionstartline"],
							"cursorselectionendchar": headers["cursorselectionendchar"],
							"cursorselectionendline": headers["cursorselectionendline"],
						};

						res.writeHead(200, { "Content-Type": "text/html" });
						res.end("Post Received");
					});
				}
			};

			const server = http.createServer(requestListener);
			server.listen(port, host, () => {
				console.log("Server Deschis");
			});


			let interval = setInterval(() => {
				const file = vscode.window.activeTextEditor?.document;

				let fileURI: string[] | undefined = file?.fileName.split('/');
				let fileName: string | undefined = fileURI === undefined ? '' : fileURI[fileURI.length - 1];

				if (fileName === file?.fileName) {
					fileURI = file?.fileName.split('\\');
					fileName = fileURI === undefined ? '' : fileURI[fileURI.length - 1];
				}

				if (cursors[fileName] !== undefined) {
					const cursor = cursors[fileName];
					const cursorPositionStart = new vscode.Position(parseInt(cursor['cursorselectionstartline']), parseInt(cursor['cursorselectionstartchar']));
					const cursorPositionEnd = new vscode.Position(parseInt(cursor['cursorselectionendline']), parseInt(cursor['cursorselectionendchar']));
					const cursorRange = new vscode.Range(cursorPositionStart, cursorPositionEnd);
					const decorationType = vscode.window.createTextEditorDecorationType({});

					vscode.window.activeTextEditor?.setDecorations(decorationType, [cursorRange]);
				}
			}, 200);
		}

	});

	/* Start a session as a client in the network
	The client will send data to the session server about the file they are editing
	as well as receive data from the server in case of changes to the code from the server */
	let startSessionAsClientCommand = vscode.commands.registerCommand('csc.startCodeSharingClient', () => {
		const port: number = 9898;
		const sock: dgram.Socket = dgram.createSocket('udp4');
		sock.bind(port);

		interface Session {
			ipString : string, 
			sessionName : string
		}

		let ip: Session[] = [];
		let startTime = new Date().getTime();
		sock.on('message', (msg) => {
			let ipString = msg.toString().split(" ")[3];
			let sessionName = msg.toString().split(" ")[4];

			if (!ip.includes({ipString, sessionName})) {
				ip.push({ipString, sessionName});

				startTime = new Date().getTime();
			}
		});

		let serverCheckInterval = setInterval(() => {
			console.log(startTime);
			console.log(ip);

			if (new Date().getTime() - startTime >= 5000) {
				sock.close();
			}
		}, 500);

		sock.on('close', async () => {
			clearInterval(serverCheckInterval);

			let chosenIP: string | undefined = await vscode.window.showQuickPick(
				ip.length === 0 ? ["No servers found on local network (Press ESC/Enter to type the server IP)"] : ip.map(e => e.ipString + " (" + e.sessionName + ")"),
				{
					"title": "Select a code sharing server: ",
				}
			);

			if (chosenIP === undefined || chosenIP === "No servers found on local network (Press ESC/Enter to type the server IP)") {
				chosenIP = await vscode.window.showInputBox(
					{
						"prompt": "Type the IP of a selected server",
					}
				);
			}
		});

		setInterval(async () => {
			const file = vscode.window.activeTextEditor?.document;

			let fileURI: string[] | undefined = file?.fileName.split('/');
			let fileName: string | undefined = fileURI === undefined ? '' : fileURI[fileURI.length - 1];

			if (fileName === file?.fileName) {
				fileURI = file?.fileName.split('\\');
				fileName = fileURI === undefined ? '' : fileURI[fileURI.length - 1];
			}

			const data = file?.getText();

			const postPath: string = "http://" + ip + ':' + port + '/sessionID/' + fileName;

			let config: AxiosRequestConfig = {
				"headers": {
					"cursorselectionstartchar": vscode.window.activeTextEditor?.selection.start.character.toString() ?? "",
					"cursorselectionstartline": vscode.window.activeTextEditor?.selection.start.line.toString() ?? "",
					"cursorselectionendchar": vscode.window.activeTextEditor?.selection.end.character.toString() ?? "",
					"cursorselectionendline": vscode.window.activeTextEditor?.selection.end.line.toString() ?? "",
				}
			};

			console.log(postPath);
			await axios.post(postPath, data, config);
		}, 100);
	});

	context.subscriptions.push(startServerCommand, startSessionAsClientCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }
