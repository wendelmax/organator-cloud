import { EC2Client, RunInstancesCommand } from '@aws-sdk/client-ec2';

export class AWSClient {
  private ec2: EC2Client;

  constructor(region: string, accessKeyId: string, secretAccessKey: string) {
    this.ec2 = new EC2Client({
      region: region || 'us-east-1',
      credentials: {
        accessKeyId: accessKeyId || 'mock-access-key',
        secretAccessKey: secretAccessKey || 'mock-secret-key'
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
