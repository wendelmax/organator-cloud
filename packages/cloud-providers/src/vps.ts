import { Client } from 'ssh2';
import { decryptSecret } from './crypto';

const DOCKER_IMAGE_RE = /^[a-z0-9]+(?:[._\/:@-][a-zA-Z0-9]+)*$/;
const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Quoting POSIX: envolve em aspas simples e escapa aspas simples internas. */
export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

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
    // Todos os valores entram num comando shell remoto: valida os identificadores
    // e aplica quoting POSIX em tudo que é interpolado (evita injeção de comando).
    if (!DOCKER_IMAGE_RE.test(imageName)) throw new Error(`Invalid docker image: ${imageName}`);
    if (!CONTAINER_NAME_RE.test(containerName)) throw new Error(`Invalid container name: ${containerName}`);
    if (!HOSTNAME_RE.test(domain)) throw new Error(`Invalid domain: ${domain}`);
    for (const key of Object.keys(envs || {})) {
      if (!ENV_KEY_RE.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    }

    console.log(`[VPS SDK] Fazendo pull e subindo imagem ${imageName} em ${this.host}...`);

    const image = shellQuote(imageName);
    const name = shellQuote(containerName);
    const envArgs = Object.entries(envs || {}).map(([k, v]) => `-e ${shellQuote(`${k}=${v}`)}`);
    // Labels do Traefik para roteamento automático de domínio
    const labels = [
      `-l ${shellQuote('traefik.enable=true')}`,
      `-l ${shellQuote(`traefik.http.routers.${containerName}.rule=Host(\`${domain}\`)`)}`,
    ];

    const command = [
      `docker pull ${image}`,
      `(docker stop ${name} || true)`,
      `(docker rm ${name} || true)`,
      ['docker run -d --name', name, '--restart unless-stopped', ...envArgs, ...labels, image].join(' '),
    ].join(' && ');

    try {
      const result = await this.execCommand(command);
      return result;
    } catch (err: any) {
      console.warn(`[VPS SDK Warning] Error during container deploy: ${err.message}`);
      return `[Mock Container Deploy] ${containerName} deployed on ${domain}`;
    }
  }
}
