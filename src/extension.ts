import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as dgram from 'dgram';
import axios, { AxiosRequestConfig } from 'axios';
import { ip } from 'address';


export function activate(context: vscode.ExtensionContext) {

	/* Start a session as the server of the session
	You will receive data from hosts actively to view their screens
	You will also be able to modify their code in real time */
	let startServerCommand = vscode.commands.registerCommand('csc.startCodeSharingServer', () => {
		const host : string | undefined = ip();
		const port : number = 9898;

		interface cursorPosition {
			[file : string] : {
				[key : string] : string
			}
		}

		let cursors : cursorPosition = {

		};

		const sock : dgram.Socket = dgram.createSocket('udp4');
		sock.bind(port);

		sock.on('listening', () => {
			sock.setBroadcast(true);

			setInterval(() => {
				sock.send("Code Sharing Server " + ip(), port, "255.255.255.255");
			}, 1000);
		});

		/* requestListener listens for POST requests with a sessionID as a resource 
		and saves the files in a /tmp/ file for the teacher to see */
		let requestListener = (req: any, res: any) : void => {
			if(req.method === "POST") {
				let file : string = '';
				let sessionID : string = path.dirname(req.url);
				let fileName : string = path.basename(req.url);

				req.on('data', (data : string) => {
					file += data;
				});

				req.on('end', () => {
					// eslint-disable-next-line @typescript-eslint/naming-convention
					const workSpacePath = vscode.workspace.workspaceFolders === undefined ? undefined : vscode.workspace.workspaceFolders[0].uri.fsPath;
					const filePath = workSpacePath + sessionID + "/" + fileName;

					fs.mkdir(workSpacePath + sessionID, (err) => console.log(err));
					fs.writeFile(filePath, file, (err) => {
						console.log(err);
					});

					const headers = JSON.parse( JSON.stringify(req.headers) );
					cursors[fileName] = {
						"cursorselectionstartchar": headers["cursorselectionstartchar"],
						"cursorselectionstartline": headers["cursorselectionstartline"],
						"cursorselectionendchar": headers["cursorselectionendchar"],
						"cursorselectionendline": headers["cursorselectionendline"],
					};

					res.writeHead(200, {"Content-Type": "text/html"});
					res.end("Post Received");
				});
			}
		};

		const server = http.createServer(requestListener);
		server.listen(port, host, () => {
			console.log("Server Deschis");
		});


		vscode.window.onDidChangeActiveTextEditor((e) => {
			if(cursors[e?.document.fileName ?? ''] !== undefined) {
				const cursor = cursors[e?.document.fileName ?? ''];
				const cursorPositionStart = new vscode.Position(parseInt(cursor['cursorselectionstartline']), parseInt(cursor['cursorselectionstartchar']));
				const cursorPositionEnd = new vscode.Position(parseInt(cursor['cursorselectionendline']), parseInt(cursor['cursorselectionendchar']));
				const cursorRange = new vscode.Range(cursorPositionStart, cursorPositionEnd);
				
				e?.revealRange(cursorRange);
			}
		});
	});

	/* Start a session as a client in the network
	The client will send data to the session server about the file they are editing
	as well as receive data from the server in case of changes to the code from the server */
	let startSessionAsClientCommand = vscode.commands.registerCommand('csc.startCodeSharingClient', () => {
		const port : number = 9898;
		const sock : dgram.Socket = dgram.createSocket('udp4');
		sock.bind(port);

		let ip : string = '';
		sock.on('message', (msg) => {
			ip = msg.toString().split(" ")[3];

			if(ip !== '') {
				sock.close();
			}
		});

		sock.on('close', () => {
			console.log(ip);
		});

		setInterval( async () => {
			const file = vscode.window.activeTextEditor?.document;

			const fileURI : string[] | undefined = file?.fileName.split('/');
			const fileName : string | undefined = fileURI === undefined ? '' : fileURI[fileURI.length - 1];
			const data = file?.getText();

			const postPath : string = "http://" + ip + ':' + port + '/sessionID/' + fileName;
			
			let config : AxiosRequestConfig = {
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
export function deactivate() {}
