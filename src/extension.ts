import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as dgram from 'dgram';
import * as os from 'os';
import * as ip from 'ip';
import axios, { AxiosRequestConfig } from 'axios';

//TODO: Add HTTPS support
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

			const specialChars = /[`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/;
			if(sessionID === undefined || sessionID === '' || specialChars.test(sessionID) === true) {
				vscode.window.showErrorMessage("CSC: Please enter a valid name for the session. (non-empty, no special characters)");
				return;
			}

			let sessionPassword = await vscode.window.showInputBox(
				{
					"prompt": "Choose a session password",
					"password": true
				}
			);

			if(sessionPassword === undefined || sessionPassword === '') {
				vscode.window.showErrorMessage("CSC: No session password entered");
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

			let decorationType : vscode.TextEditorDecorationType;
			
			const color = new vscode.ThemeColor('selection.background');
			decorationType = vscode.window.createTextEditorDecorationType({
				fontStyle: "italic",
				fontWeight: "700",
				backgroundColor: color,
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
					

					vscode.window.activeTextEditor?.setDecorations(decorationType, [cursorRange]);
				}
			}, 200);
		}

	});

	/* Start a session as a client in the network
	The client will send data to the session server about the file they are editing
	as well as receive data from the server in case of changes to the code from the server */
	let startSessionAsClientCommand = vscode.commands.registerCommand('csc.startCodeSharingClient', () => {
		interface Session {
			ipString : string, 
			sessionName : string
		}

		const port: number = 9898;
		const sock: dgram.Socket = dgram.createSocket('udp4');
		sock.bind(port);

		let sessions: Session[] = [];
		let startTime = new Date().getTime();
		sock.on('message', (msg) => {
			let ipString = msg.toString().split(" ")[3];
			let sessionName = msg.toString().split(" ")[4];

			if (sessions.find(session => session.ipString === ipString) === undefined) {
				sessions.push({ipString, sessionName});

				startTime = new Date().getTime();
			}
		});

		let intervalFinished = false;
		let serverCheckInterval = setInterval(() => {
			console.log(startTime);
			console.log(sessions);

			if (new Date().getTime() - startTime >= 5000) {
				sock.close();
			}
		}, 500);

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: false,
			title: 'CSC: Locating code sharing servers.'
		}, async (progress) => {
			progress.report({increment: 0});

			await new Promise(resolve => setInterval(() => {
				if(intervalFinished === true) {
					resolve(true);
				}
			}, 2750));

			progress.report({increment: 100});
		});

		let chosenIP: string | undefined = '';
		let chosenName: string | undefined = '';
		let sessionID: string | undefined = '';
		let sessionPassword: string | undefined = '';

		sock.on('close', async () => {
			clearInterval(serverCheckInterval);
			intervalFinished = true;

			chosenIP = await vscode.window.showQuickPick(
				sessions.length === 0 ? ["No servers found on local network (Press ESC/Enter to type the server IP)"] : sessions.map(e => e.ipString + " (" + e.sessionName + ")"),
				{
					"title": "Select a code sharing server: ",
				}
			);

			sessionID = chosenIP?.split(" ")[1];
			chosenIP = chosenIP?.split(" ")[0];

			if (chosenIP === undefined || chosenIP === "No servers found on local network (Press ESC/Enter to type the server IP)") {
				chosenIP = await vscode.window.showInputBox(
					{
						"prompt": "Type the IP of a selected server",
					}
				);
			}

			chosenName = await vscode.window.showInputBox(
				{
					"prompt": "Enter your username for the session"
				}
			);

			if(chosenName === undefined || chosenName === '') {
				vscode.window.showErrorMessage("CSC: No username entered");
				deactivate();
				return;
			}

			sessionPassword = await vscode.window.showInputBox(
				{
					"prompt": "Enter the session password",
					"password": true
				}
			);

			if(sessionPassword === undefined || sessionPassword === '') {
				vscode.window.showErrorMessage("CSC: No session password entered");
				deactivate();
				return;
			}
		});

		
		setInterval( async () => {
			const file = vscode.window.activeTextEditor?.document;

			let fileURI: string[] | undefined = file?.fileName.split('/');
			let fileName: string | undefined = fileURI === undefined ? '' : fileURI[fileURI.length - 1];

			if (fileName === file?.fileName) {
				fileURI = file?.fileName.split('\\');
				fileName = fileURI === undefined ? '' : fileURI[fileURI.length - 1];
			}

			const data = file?.getText();

			const postPath: string = "http://" + chosenIP + ':' + port + "/" + sessionID + "/" + chosenName + fileName;

			let config: AxiosRequestConfig = {
				"headers": {
					"cursorselectionstartchar": vscode.window.activeTextEditor?.selection.start.character.toString() ?? "",
					"cursorselectionstartline": vscode.window.activeTextEditor?.selection.start.line.toString() ?? "",
					"cursorselectionendchar": vscode.window.activeTextEditor?.selection.end.character.toString() ?? "",
					"cursorselectionendline": vscode.window.activeTextEditor?.selection.end.line.toString() ?? "",
					"password": sessionPassword,
				}
			};
			
			console.log(postPath);
			await axios.post(postPath, data, config);
		}, 500);
	});

	context.subscriptions.push(startServerCommand, startSessionAsClientCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }
