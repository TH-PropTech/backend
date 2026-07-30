import Joi from 'joi'

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('local', 'development', 'test', 'staging', 'production')
    .default('local'),
  APP_PORT: Joi.number().port().default(3001),
  APP_URL: Joi.string().uri().default('http://localhost:3001'),
  APP_CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_LOGGING: Joi.boolean().default(false),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  RECOMMENDATION_API_URL: Joi.string()
    .uri()
    .default('http://localhost:5001/api'),
})
