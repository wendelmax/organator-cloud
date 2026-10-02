import axios from 'axios';
import { decryptSecret } from './crypto';
import { simulateOrThrow } from './simulation';

export class VercelClient {
  private apiToken: string;
  private teamId?: string;

  constructor(apiToken: string, teamId?: string) {
    this.apiToken = decryptSecret(apiToken);
    this.teamId = teamId ? decryptSecret(teamId) : teamId;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private get baseUrl() {
    return 'https://api.vercel.com';
  }

  async createProject(name: string, gitRepositoryUrl: string) {
    console.log(`[Vercel SDK] Creating project ${name} from ${gitRepositoryUrl}...`);
    try {
      const url = `${this.baseUrl}/v9/projects${this.teamId ? `?teamId=${this.teamId}` : ''}`;
      const res = await axios.post(url, { name, gitRepository: { type: 'github', repo: gitRepositoryUrl } }, { headers: this.headers });
      return res.data;
    } catch (err: any) {
      return simulateOrThrow('Vercel', `create project ${name}`, err, () => ({ id: `prj_${name}`, name }));
    }
  }

  async injectEnvVar(projectId: string, key: string, value: string) {
    console.log(`[Vercel SDK] Injecting Env Var ${key} into project ${projectId}...`);
    try {
      const url = `${this.baseUrl}/v9/projects/${projectId}/env${this.teamId ? `?teamId=${this.teamId}` : ''}`;
      await axios.post(url, { key, value, type: 'encrypted', target: ['production'] }, { headers: this.headers });
      return true;
    } catch (err: any) {
      return simulateOrThrow('Vercel', `set env var ${key}`, err, () => true);
    }
  }

  async createDeployment(projectId: string) {
    console.log(`[Vercel SDK] Triggering deployment for project ${projectId}...`);
    try {
      const url = `${this.baseUrl}/v13/deployments${this.teamId ? `?teamId=${this.teamId}` : ''}`;
      const res = await axios.post(url, { name: projectId, project: projectId }, { headers: this.headers });
      return res.data?.url || `https://${projectId}.vercel.app`;
    } catch (err: any) {
      return simulateOrThrow('Vercel', `deploy ${projectId}`, err, () => `https://${projectId}.vercel.app`);
    }
  }
}
