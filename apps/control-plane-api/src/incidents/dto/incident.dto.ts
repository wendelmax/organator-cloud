import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
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

/**
 * PATCH: campos não-nulos rejeitam `null` explícito (@ValidateIf só deixa
 * passar `undefined`; `@IsOptional` aceitaria null e estouraria 500 no Prisma
 * em colunas NOT NULL). `assigneeEmail`/`postmortemUrl` são anuláveis no
 * schema, então seguem @IsOptional (limpar o campo é PATCH com null).
 * `source`/`alertKey` são exclusivos do create: alertKey tem índice único
 * (P2002 → 500) e source descreve a origem original do incidente.
 */
export class UpdateIncidentDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['critical', 'major', 'minor'])
  severity?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['investigating', 'identified', 'monitoring', 'resolved'])
  status?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['api', 'dashboard', 'provisioning', 'billing', 'data-plane'])
  component?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  public?: boolean;

  @IsOptional()
  @IsEmail()
  assigneeEmail?: string;

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
