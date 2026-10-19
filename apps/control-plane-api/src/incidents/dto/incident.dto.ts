import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Incidentes operacionais (#110). Os enums espelham os comentários do schema
 * do Prisma; `authorEmail` NÃO existe aqui de propósito — o autor vem sempre
 * do JWT, nunca do corpo da requisição.
 */
export class CreateIncidentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsIn(['critical', 'major', 'minor'])
  severity?: string;

  @IsOptional()
  @IsIn(['investigating', 'identified', 'monitoring', 'resolved'])
  status?: string;

  @IsOptional()
  @IsIn(['api', 'dashboard', 'provisioning', 'billing', 'data-plane'])
  component?: string;

  @IsOptional()
  @IsBoolean()
  public?: boolean;

  @IsOptional()
  @IsEmail()
  assigneeEmail?: string;

  @IsOptional()
  @IsString()
  source?: string;

  // Opcional, mas vazio não vale: a chave de dedup não pode ser "".
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  alertKey?: string;

  @IsOptional()
  @IsString()
  postmortemUrl?: string;
}

/** Mesmos campos do create, tudo opcional (PATCH). */
export class UpdateIncidentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsIn(['critical', 'major', 'minor'])
  severity?: string;

  @IsOptional()
  @IsIn(['investigating', 'identified', 'monitoring', 'resolved'])
  status?: string;

  @IsOptional()
  @IsIn(['api', 'dashboard', 'provisioning', 'billing', 'data-plane'])
  component?: string;

  @IsOptional()
  @IsBoolean()
  public?: boolean;

  @IsOptional()
  @IsEmail()
  assigneeEmail?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  alertKey?: string;

  @IsOptional()
  @IsString()
  postmortemUrl?: string;
}

/** Entrada da linha do tempo; o autor (authorEmail) vem do JWT. */
export class AddUpdateDto {
  @IsIn(['investigating', 'identified', 'monitoring', 'resolved'])
  status!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
