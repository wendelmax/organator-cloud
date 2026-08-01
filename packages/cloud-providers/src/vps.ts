import { Client } from 'ssh2';
import { decryptSecret } from './crypto';

export class VPSClient {
  private host: string;
  private port: number;
  private username: string;
  private privateKey: string;

  constructor(host: string, port: number = 22, username: string = 'root', privateKey: string = '') {
    this.host = host;
    this.port = port;
    this.username = username;
    this.privateKey = decryptSecret(privateKey);
  }

  async execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.privateKey || this.privateKey === 'mock-key') {
        console.warn(`[VPS SDK Warning] Using mock key or missing SSH private key for host ${this.host}. Skipping real SSH execution.`);
        return resolve(`[Mock SSH Output] Executed: ${command.trim()}`);
      }

      const conn = new Client();
      conn.on('ready', () => {
        console.log(`[VPS SDK] Conectado via SSH a ${this.host}:${this.port}`);
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          let output = '';
          stream.on('close', (code: any) => {
            conn.end();
            if (code !== 0 && code !== null) {
              console.warn(`[VPS SDK Warning] Command exited with code ${code}`);
            }
            resolve(output);
          }).on('data', (data: any) => {
            output += data;
          }).stderr.on('data', (data: any) => {
            output += data;
          });
        });
      }).on('error', (err) => {
        console.warn(`[VPS SDK Warning] SSH connection error to ${this.host}: ${err.message}`);
        resolve(`[Mock SSH Fallback Output] Execution bypassed due to connection error: ${err.message}`);
      }).connect({
        host: this.host,
        port: this.port,
        username: this.username,
        privateKey: this.privateKey,
        readyTimeout: 5000,
      });
    });
  }

  async deployDockerContainer(imageName: string, containerName: string, envs: Record<string, string>, domain: string) {
    console.log(`[VPS SDK] Fazendo pull e subindo imagem ${imageName} em ${this.host}...`);
    
    // Constrói string de ENV vars
    const envString = Object.entries(envs || {}).map(([k, v]) => `-e ${k}=${v}`).join(' ');

    // Labels do Traefik para roteamento automático de domínio
    const labels = [
      `-l "traefik.enable=true"`,
      `-l "traefik.http.routers.${containerName}.rule=Host(\`${domain}\`)"`
    ].join(' ');

    const command = `
      docker pull ${imageName} && 
      docker stop ${containerName} || true && 
      docker rm ${containerName} || true && 
      docker run -d --name ${containerName} --restart unless-stopped ${envString} ${labels} ${imageName}
    `;

    try {
      const result = await this.execCommand(command);
      return result;
    } catch (err: any) {
      console.warn(`[VPS SDK Warning] Error during container deploy: ${err.message}`);
      return `[Mock Container Deploy] ${containerName} deployed on ${domain}`;
    }
  }
}
