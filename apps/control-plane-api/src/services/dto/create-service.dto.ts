import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(['VERCEL', 'AWS', 'DOCKER_VPS'])
  cloudProvider: 'VERCEL' | 'AWS' | 'DOCKER_VPS';

  @IsString()
  @IsOptional()
  repositoryUrl?: string;

  @IsString()
  @IsOptional()
  repository?: string;
}
