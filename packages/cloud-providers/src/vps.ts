import { Client } from 'ssh2';

export class VPSClient {
  private host: string;
  private port: number;
  private username: string;
  private privateKey: string;

  constructor(host: string, port: number, username: string, privateKey: string) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.privateKey = privateKey;
  }

  async execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => {
        console.log(`[VPS SDK] Conectado via SSH a ${this.host}`);
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          let output = '';
          stream.on('close', (code: any, signal: any) => {
            conn.end();
            resolve(output);
          }).on('data', (data: any) => {
            output += data;
          }).stderr.on('data', (data: any) => {
            output += data;
          });
        });
      }).on('error', (err) => {
        reject(err);
      }).connect({
        host: this.host,
        port: this.port,
        username: this.username,
        privateKey: this.privateKey
      });
    });
  }

  async deployDockerContainer(imageName: string, containerName: string, envs: Record<string, string>, domain: string) {
    console.log(`[VPS SDK] Fazendo pull e subindo imagem ${imageName}...`);
    
    // Constrói string de ENV vars
    const envString = Object.entries(envs).map(([k, v]) => `-e ${k}=${v}`).join(' ');

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

    const result = await this.execCommand(command);
    return result;
  }
}
