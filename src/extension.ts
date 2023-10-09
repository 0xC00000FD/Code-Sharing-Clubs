import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as dgram from 'dgram';
import { ip } from 'address';


export function activate(context: vscode.ExtensionContext) {

	/* Start a session as the server of the session
	You will receive data from hosts actively to view their screens
	You will also be able to modify their code in real time */
	let startServerCommand = vscode.commands.registerCommand('csc.startCodeSharingServer', () => {
		const host : string | undefined = ip();
		const port : number = 9898;

		const sock = dgram.createSocket('udp4');
		sock.bind(port);

		sock.on('listening', () => {
			sock.setBroadcast(true);

			setInterval(() => {
				sock.send("Code Sharing Server " + host, port, "255.255.255.255");
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
					console.log("Data: " + data);
				});

				req.on('end', () => {
					// eslint-disable-next-line @typescript-eslint/naming-convention
					fs.writeFile("." + sessionID + "/" + fileName, file, (err) => {
						console.log(err);
					});

					res.writeHead(200, {"Content-Type": "text/html"});
					res.end("Post Received");
				});
			}
		};

		const server = http.createServer(requestListener);
		server.listen(port, host, () => {
			console.log("Server Deschis");
		});
	});

	/* Start a session as a client in the network
	The client will send data to the session server about the file they are editing
	as well as receive data from the server in case of changes to the code from the server */
	let startSessionAsClientCommand = vscode.commands.registerCommand('csc.startCodeSharingClient', async () => {
		const port : number = 9898;
		const sock = dgram.createSocket('udp4');
		sock.bind(port);

		let ip = '';
		sock.on('message', (msg) => {
			ip = msg.toString().split(" ")[3];

			if(ip !== '') {
				sock.close();
			}
		});

		console.log(ip);
	});

	context.subscriptions.push(startServerCommand, startSessionAsClientCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
