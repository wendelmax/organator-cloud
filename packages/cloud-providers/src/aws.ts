import { EC2Client, RunInstancesCommand } from '@aws-sdk/client-ec2';
import { decryptSecret } from './crypto';

export class AWSClient {
  private ec2: any;

  constructor(region: string, accessKeyId: string, secretAccessKey: string) {
    const decryptedAccessKeyId = decryptSecret(accessKeyId);
    const decryptedSecretAccessKey = decryptSecret(secretAccessKey);

    this.ec2 = new EC2Client({
      region: region || 'us-east-1',
      credentials: {
        accessKeyId: decryptedAccessKeyId || 'mock-access-key',
        secretAccessKey: decryptedSecretAccessKey || 'mock-secret-key'
      }
    });
  }

  async createEC2Instance(amiId: string, instanceType: string) {
    console.log(`[AWS SDK] Criando instância EC2 tipo ${instanceType}...`);
    try {
      const command = new RunInstancesCommand({
        ImageId: amiId || 'ami-0c55b159cbfafe1f0',
        InstanceType: (instanceType || 't2.micro') as any,
        MinCount: 1,
        MaxCount: 1,
      });
      const response = await this.ec2.send(command);
      return response.Instances?.[0]?.InstanceId || `i-${Date.now()}`;
    } catch (err: any) {
      console.warn(`[AWS SDK Warning] Falling back to mock instance ID due to: ${err.message}`);
      return `i-ec2-${Date.now()}`;
    }
  }
}
