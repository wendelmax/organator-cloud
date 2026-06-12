import { EC2Client, RunInstancesCommand } from '@aws-sdk/client-ec2';

export class AWSClient {
  private ec2: EC2Client;

  constructor(region: string, accessKeyId: string, secretAccessKey: string) {
    this.ec2 = new EC2Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
  }

  async createEC2Instance(amiId: string, instanceType: string) {
    console.log(`[AWS SDK] Criando instância EC2 tipo ${instanceType}...`);
    // Example implementation using real SDK
    /*
    const command = new RunInstancesCommand({
      ImageId: amiId,
      InstanceType: instanceType as any,
      MinCount: 1,
      MaxCount: 1,
    });
    const response = await this.ec2.send(command);
    return response.Instances?.[0]?.InstanceId;
    */
    return `i-mocked-${Date.now()}`;
  }
}
