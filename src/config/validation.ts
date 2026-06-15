import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, validateSync, IsOptional, IsUrl } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 3001;

  // JWT
  @IsString()
  JWT_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRE!: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRE!: string;

  // Keycloak
  @IsUrl({ require_tld: false })
  KEYCLOAK_URL!: string;

  @IsString()
  KEYCLOAK_REALM!: string;

  @IsString()
  KEYCLOAK_CLIENT_ID!: string;

  @IsString()
  KEYCLOAK_CLIENT_SECRET!: string;

  @IsString()
  KEYCLOAK_ADMIN_USERNAME!: string;

  @IsString()
  KEYCLOAK_ADMIN_PASSWORD!: string;

  @IsOptional()
  @IsString()
  KEYCLOAK_ADMIN_REALM!: string;

  @IsOptional()
  @IsString()
  KEYCLOAK_ADMIN_CLIENT_ID!: string;

  // Fineract

  @IsUrl({ require_tld: false })
  FINERACT_API_URL!: string;

  @IsString()
  FINERACT_TENANT!: string;

  @IsString()
  FINERACT_USERNAME!: string;

  @IsString()
  FINERACT_PASSWORD!: string;

  // Optional configs
  @IsOptional()
  @IsString()
  MONGODB_URI!: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS!: string;

  @IsOptional()
  @IsString()
  DEFAULT_EMAIL_DOMAIN!: string;

  // BNPL Configuration
  @IsOptional()
  @IsNumber()
  BNPL_LOAN_PRODUCT_ID!: number;

  @IsOptional()
  @IsNumber()
  BNPL_CREDIT_LIMIT!: number;

  @IsOptional()
  @IsNumber()
  BNPL_DEFAULT_REPAYMENTS!: number;

  @IsOptional()
  @IsNumber()
  BNPL_MIN_AMOUNT!: number;

  @IsOptional()
  @IsNumber()
  BNPL_MAX_AMOUNT!: number;

  @IsOptional()
  @IsNumber()
  BNPL_MAX_REPAYMENTS!: number;

  @IsOptional()
  @IsNumber()
  BNPL_CURRENCY_MULTIPLES!: number;

  // Legacy support (fallback)
  @IsOptional()
  @IsNumber()
  DEFAULT_BNPL_LOAN_PRODUCT_ID!: number;

  @IsOptional()
  @IsNumber()
  DEFAULT_BNPL_CREDIT_LIMIT!: number;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map(e => Object.values(e.constraints || {}).join(', ')).join('\n')}`,
    );
  }

  return validatedConfig;
}