import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { NestFactory } from '@nestjs/core'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Logger } from '@nestjs/common'
import { AppModule } from '../app.module'
import { RecommendationHistory } from '../modules/recommendations/schemas/recommendation-history.schema'

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

async function seedRecommendationHistory(): Promise<void> {
  const logger = new Logger('SeedRecommendationHistory')
  logger.log('Starting migration of rental history from CSV to MongoDB...')

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const historyRepo = app.get<Repository<RecommendationHistory>>(
      getRepositoryToken(RecommendationHistory)
    )

    const existingCount = await historyRepo.count()
    if (existingCount > 0) {
      logger.log(
        `Found ${existingCount} existing recommendation history records. Skipping CSV import.`
      )
      await app.close()
      return
    }

    // Locate CSV
    const csvPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'python',
      'building-recommendation',
      'dataset',
      'rental_history.csv'
    )

    if (!fs.existsSync(csvPath)) {
      logger.warn(
        `CSV file not found at ${csvPath}. Generating default seed history records...`
      )
      await app.close()
      return
    }

    const content = fs.readFileSync(csvPath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim() !== '')

    if (lines.length <= 1) {
      logger.warn('CSV file is empty or only contains header.')
      await app.close()
      return
    }

    const recordsToInsert: Partial<RecommendationHistory>[] = []

    // Header: user_age,user_income,preferred_district,preferred_bedrooms,requires_gym,requires_parking,rented_apartment_id,satisfaction_score
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const parts = line.split(',').map(p => p.trim())
      if (parts.length < 7) continue

      const rawAge = parts[0]
      const rawIncome = parts[1]
      const rawDistrict = parts[2]
      const rawBedrooms = parts[3]
      const rawGym = parts[4]
      const rawParking = parts[5]
      const rawAptId = parts[6]
      const rawScore = parts[7]

      if (
        !rawAge ||
        !rawIncome ||
        !rawDistrict ||
        !rawBedrooms ||
        !rawGym ||
        !rawParking ||
        !rawAptId
      ) {
        continue
      }

      const userAge = parseInt(rawAge, 10)
      const userIncome = parseFloat(rawIncome)
      const preferredDistrict = rawDistrict
      const preferredBedrooms = parseInt(rawBedrooms, 10)
      const requiresGym = parseInt(rawGym, 10)
      const requiresParking = parseInt(rawParking, 10)
      const rentedApartmentId = rawAptId
      const satisfactionScore = rawScore ? parseFloat(rawScore) : 5.0

      if (!isNaN(userAge) && !isNaN(userIncome)) {
        recordsToInsert.push({
          userAge,
          userIncome,
          preferredDistrict,
          preferredBedrooms,
          requiresGym,
          requiresParking,
          rentedApartmentId,
          satisfactionScore,
        })
      }
    }

    logger.log(
      `Parsed ${recordsToInsert.length} records from CSV. Inserting in batches...`
    )

    const batchSize = 1000
    for (let i = 0; i < recordsToInsert.length; i += batchSize) {
      const batch = recordsToInsert.slice(i, i + batchSize)
      const entities = historyRepo.create(batch)
      await historyRepo.save(entities)
      logger.log(
        `Inserted batch ${i + 1} - ${Math.min(i + batchSize, recordsToInsert.length)} / ${recordsToInsert.length}`
      )
    }

    const totalInserted = await historyRepo.count()
    logger.log(
      `Successfully seeded ${totalInserted} recommendation history records into MongoDB!`
    )
  } catch (error) {
    logger.error('Error seeding recommendation history:', error)
  } finally {
    await app.close()
  }
}

void seedRecommendationHistory()
