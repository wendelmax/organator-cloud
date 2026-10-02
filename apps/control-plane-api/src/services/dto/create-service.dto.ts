import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  Matches,
} from 'class-validator';

export class CreateServiceDto {
  // Opcional: o tenant efetivo vem da sessão (só admin da plataforma escolhe).
  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  // DOCKER_VPS é aceito por compatibilidade e gravado como VPS (o valor que o
  // painel envia e o worker entende).
  @IsIn(['VERCEL', 'AWS', 'VPS', 'DOCKER_VPS'])
  cloudProvider!: 'VERCEL' | 'AWS' | 'VPS' | 'DOCKER_VPS';

  @IsString()
  @IsOptional()
  repositoryUrl?: string;

  @IsString()
  @IsOptional()
  repository?: string;

  /** Imagem Docker publicada no deploy em VPS (ex.: ghcr.io/acme/api:1.2.0). */
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9._\-/:@]*$/i, {
    message: 'image must be a docker image reference',
  })
  image?: string;

  /** Destino do deploy em VPS, no formato user@host. */
  @IsOptional()
  @Matches(/^[a-z_][a-z0-9_-]*@[a-z0-9.-]+$/i, {
    message: 'vpsHost must be user@host',
  })
  vpsHost?: string;
}
