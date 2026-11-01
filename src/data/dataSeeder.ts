/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
import * as dotenv from 'dotenv'
import * as dns from 'dns'
import * as path from 'path'

// Nạp tệp .env sớm để lấy cấu hình DNS
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

const dnsServers = process.env.NODE_DNS_SERVERS
if (dnsServers) {
  const servers = dnsServers
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (servers.length > 0) {
    try {
      dns.setServers(servers)
      dns.promises.setServers(servers)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Không thể thiết lập DNS servers tùy chỉnh:', err)
    }
  }
}

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import * as fs from 'fs'
import { User, UserStatus } from '../modules/users/schemas/user.schema'
import { Apartment } from '../modules/properties/schemas/apartment.schema'
import type { KycInfo } from '../modules/users/schemas/user.schema'
import { ObjectId } from 'mongodb'
import { Contract } from '../modules/contracts/schemas/contract.schema'
import { Project } from '../modules/properties/schemas/project.schema'
import type { RecommendationHistory } from '../modules/properties/recommendations/schemas/recommendation-history.schema'
import { ActivityLog } from '../modules/activity-log/schemas/activity-log.schema'
import { KindScopedActivityLogRepository } from '../modules/activity-log/utils/kind-scoped-activity-log.repository'
import { toRecommendationHistory } from '../modules/activity-log/utils/legacy-log.mapper'
import { Logger } from '@nestjs/common'

async function bootstrap(): Promise<void> {
  const logger = new Logger('DataSeeder')
  logger.log('Bắt đầu khởi chạy dữ liệu mẫu (Database Seeding)...')

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const userRepository = app.get<Repository<User>>(getRepositoryToken(User))
    const apartmentRepository = app.get<Repository<Apartment>>(
      getRepositoryToken(Apartment)
    )
    const contractRepository = app.get<Repository<Contract>>(
      getRepositoryToken(Contract)
    )
    const projectRepository = app.get<Repository<Project>>(
      getRepositoryToken(Project)
    )
    const historyRepository = new KindScopedActivityLogRepository(
      app.get<Repository<ActivityLog>>(getRepositoryToken(ActivityLog)),
      'recommendation',
      toRecommendationHistory
    )

    // 1. Dọn dẹp dữ liệu mẫu cũ (Tùy chọn)
    logger.log('Đang dọn dẹp các dữ liệu mẫu cũ...')
    await userRepository.delete({
      email: {
        $in: [
          'landlord@example.com',
          'individual@example.com',
          'tenant@example.com',
          'staff@example.com',
          'admin@example.com',
        ],
      } as any,
    })
    await projectRepository.delete({ name: 'Vinhomes Central Park' })

    // 2. Tạo tài khoản người dùng mẫu
    const saltRounds = 10
    const commonPasswordHash = await bcrypt.hash('password123', saltRounds)

    logger.log('Đang tạo các tài khoản người dùng mẫu...')

    // Landlord
    const landlord = userRepository.create({
      fullName: 'LÊ HOÀNG MINH',
      email: 'landlord@example.com',
      phone: '01209300567',
      passwordHash: commonPasswordHash,
      role: 'landlord',
      status: UserStatus.ACTIVE,
      kycStatus: 'verified',
      walletAddress: '0xLandlordWalletAddress1234567890',
      profile: {
        firstName: 'Minh',
        lastName: 'Lê Hoàng',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e',
      },
    })
    const savedLandlord = await userRepository.save(landlord)
    logger.log(`Tạo Landlord thành công: ${savedLandlord.email}`)

    // Individual Landlord (Chủ lẻ cá nhân)
    const individualLandlord = userRepository.create({
      fullName: 'PHẠM THỊ HƯƠNG',
      email: 'individual@example.com',
      phone: '0376543210',
      passwordHash: commonPasswordHash,
      role: 'landlord',
      status: UserStatus.ACTIVE,
      kycStatus: 'verified',
      walletAddress: '0xIndividualLandlordWallet9876543210',
      profile: {
        firstName: 'Hương',
        lastName: 'Phạm Thị',
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
      },
    })
    const savedIndividualLandlord =
      await userRepository.save(individualLandlord)
    logger.log(
      `Tạo Individual Landlord thành công: ${savedIndividualLandlord.email}`
    )

    // Tenant
    const tenant = userRepository.create({
      fullName: 'NGUYỄN VĂN A',
      email: 'tenant@example.com',
      phone: '03809600123',
      passwordHash: commonPasswordHash,
      role: 'tenant',
      status: UserStatus.ACTIVE,
      kycStatus: 'verified',
      walletAddress: '0xTenantWalletAddress1234567890',
      profile: {
        firstName: 'A',
        lastName: 'Nguyễn Văn',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde',
      },
    })
    const savedTenant = await userRepository.save(tenant)
    logger.log(`Tạo Tenant thành công: ${savedTenant.email}`)

    // Staff
    const staff = userRepository.create({
      fullName: 'TRẦN QUỐC BẢO',
      email: 'staff@example.com',
      phone: '0901234567',
      passwordHash: commonPasswordHash,
      role: 'staff',
      status: UserStatus.ACTIVE,
      kycStatus: 'verified',
    })
    await userRepository.save(staff)
    logger.log(`Tạo Staff thành công: ${staff.email}`)

    // Admin
    const admin = userRepository.create({
      fullName: 'ADMIN THACHTAKI',
      email: 'admin@example.com',
      phone: '0999888777',
      passwordHash: commonPasswordHash,
      role: 'admin',
      status: UserStatus.ACTIVE,
      kycStatus: 'verified',
    })
    await userRepository.save(admin)
    logger.log(`Tạo Admin thành công: ${admin.email}`)

    // 3. Tạo KYC Record mẫu
    logger.log('Đang tạo hồ sơ KYC mẫu...')
    // Hồ sơ KYC mẫu nhúng trong users.kyc (G-KYC): ghi đè hồ sơ cũ của hai user
    const sampleKyc = (
      fields: Partial<KycInfo> &
        Pick<
          KycInfo,
          | 'idCardNumber'
          | 'fullName'
          | 'dateOfBirth'
          | 'placeOfResidence'
          | 'frontCardUrl'
          | 'backCardUrl'
          | 'selfieUrl'
        >
    ): KycInfo => {
      const now = new Date()
      return {
        recordId: new ObjectId(),
        status: 'verified',
        rejectedReason: null,
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
        ...fields,
      }
    }
    await userRepository.update(savedLandlord._id, {
      kyc: sampleKyc({
        idCardNumber: '012093005678',
        fullName: 'LÊ HOÀNG MINH',
        dateOfBirth: '20/12/1985',
        placeOfResidence: '100 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
        frontCardUrl:
          'https://images.unsplash.com/photo-1554774853-719586f82d77',
        backCardUrl:
          'https://images.unsplash.com/photo-1554774853-719586f82d77',
        selfieUrl:
          'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e',
      }),
    })

    await userRepository.update(savedTenant._id, {
      kyc: sampleKyc({
        idCardNumber: '038096001234',
        fullName: 'NGUYỄN VĂN A',
        dateOfBirth: '15/08/1996',
        placeOfResidence: '720A Điện Biên Phủ, Phường 22, Bình Thạnh, TP.HCM',
        frontCardUrl:
          'https://images.unsplash.com/photo-1554774853-719586f82d77',
        backCardUrl:
          'https://images.unsplash.com/photo-1554774853-719586f82d77',
        selfieUrl:
          'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde',
      }),
    })
    logger.log('Tạo hồ sơ KYC mẫu thành công!')

    // 4. Tạo các dự án (Projects) mẫu
    logger.log('Đang tạo các dự án mẫu...')
    await projectRepository.delete({
      name: { $in: ['Vinhomes Central Park', 'Masteri Thảo Điền'] } as any,
    })

    // Dự án 1: Vinhomes Central Park
    const projectVinhomes = projectRepository.create({
      name: 'Vinhomes Central Park',
      description:
        'Khu đô thị hiện đại và cao cấp bậc nhất Việt Nam với công viên ven sông 14ha.',
      location: '208 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Bình Thạnh',
      investor: 'Vingroup',
      amenities: [
        'Công viên 14ha',
        'Bệnh viện Vinmec',
        'Trường học Vinschool',
        'Trung tâm thương mại Landmark 81',
      ],
      images: [
        'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200',
        'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200',
      ],
    })
    const savedProject1 = await projectRepository.save(projectVinhomes)
    logger.log(`Tạo dự án mẫu thành công: ${savedProject1.name}`)

    // Dự án 2: Masteri Thảo Điền
    const projectMasteri = projectRepository.create({
      name: 'Masteri Thảo Điền',
      description:
        'Dự án căn hộ cao cấp tại trung tâm Quận 2 cũ, kết nối trực tiếp ga metro Bến Thành - Suối Tiên.',
      location: '159 Xa lộ Hà Nội, Thảo Điền, Quận 2, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Quận 2',
      investor: 'Thảo Điền Investment',
      amenities: [
        'Hồ bơi cảnh quan',
        'Khu BBQ ngoài trời',
        'Phòng Gym hiện đại',
        'Trung tâm thương mại Vincom Mega Mall',
      ],
      images: [
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200',
        'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200',
      ],
    })
    const savedProject2 = await projectRepository.save(projectMasteri)
    logger.log(`Tạo dự án mẫu thành công: ${savedProject2.name}`)

    // 5. Tạo các căn hộ (Apartments) mẫu
    logger.log('Đang tạo các căn hộ mẫu...')
    await apartmentRepository.delete({})

    // Căn hộ 1 (Vinhomes Central Park)
    const apartment1 = apartmentRepository.create({
      title: 'Vinhomes Central Park - Căn hộ 2PN #102',
      category: 'Chung cư',
      description:
        'Căn hộ Vinhomes Central Park view sông thoáng mát, nội thất cao cấp sang trọng.',
      location: 'Bình Thạnh, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Bình Thạnh',
      ward: 'Phường 22',
      street: 'Nguyễn Hữu Cảnh',
      address:
        'Vinhomes Central Park, 208 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
      priceMonthly: 18000000,
      area: 75,
      bedrooms: 2,
      bathrooms: 2,
      direction: 'Đông Nam',
      balconyDirection: 'Đông Nam',
      furniture: 'Đầy đủ nội thất cao cấp',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_ixjldr.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_nquhie.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_or8yr0.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_zea4ow.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_djmgni.jpg',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach360_qchdyn.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu360_blmllu.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc360_trstwe.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep360_ehr4pr.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong360_hq44xx.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=vinhomes-demo',
      amenities: [
        'Bể bơi',
        'Phòng gym',
        'Công viên',
        'Bảo vệ 24/7',
        'Siêu thị',
      ],
      status: 'available',
      isVerified: true,
      landlordId: savedLandlord._id.toHexString(),
      projectId: savedProject1._id.toHexString(),
      projectName: savedProject1.name,
    })
    const savedApartment1 = await apartmentRepository.save(apartment1)
    logger.log(`Tạo căn hộ 1 thành công: ${savedApartment1.title}`)

    // Căn hộ 2 (Vinhomes Central Park)
    const apartment2 = apartmentRepository.create({
      title: 'Vinhomes Central Park - Studio #3005',
      category: 'Chung cư',
      description:
        'Căn hộ Studio Vinhomes Central Park tối giản hiện đại, tiện lợi cho người độc thân.',
      location: 'Bình Thạnh, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Bình Thạnh',
      ward: 'Phường 22',
      street: 'Nguyễn Hữu Cảnh',
      address:
        'Vinhomes Central Park, 208 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
      priceMonthly: 13000000,
      area: 45,
      bedrooms: 1,
      bathrooms: 1,
      direction: 'Đông',
      balconyDirection: 'Đông',
      furniture: 'Đầy đủ nội thất thông minh',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_ocrf14.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_byaar1.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_c123nn.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_p5omsl.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_nr5xs1.jpg',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach360_fbbffh.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu360_xrhtua.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc360_jdfqtz.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep360_wjj1wh.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong360_yohcri.jpg',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=vinhomes-studio',
      amenities: [
        'Bể bơi',
        'Phòng gym',
        'Công viên',
        'Bảo vệ 24/7',
        'Siêu thị',
      ],
      status: 'available',
      isVerified: true,
      landlordId: savedIndividualLandlord._id.toHexString(),
      projectId: null,
      projectName: null,
    })
    const savedApartment2 = await apartmentRepository.save(apartment2)
    logger.log(`Tạo căn hộ 2 thành công: ${savedApartment2.title}`)

    // Căn hộ 3 (Vinhomes Central Park)
    const apartment3 = apartmentRepository.create({
      title: 'Vinhomes Central Park - Căn hộ 3PN #4012',
      category: 'Chung cư',
      description:
        'Căn hộ Vinhomes Central Park 3 phòng ngủ rộng rãi, view trực diện Landmark 81 cực đẹp.',
      location: 'Bình Thạnh, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Bình Thạnh',
      ward: 'Phường 22',
      street: 'Nguyễn Hữu Cảnh',
      address:
        'Vinhomes Central Park, 208 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
      priceMonthly: 28000000,
      area: 110,
      bedrooms: 3,
      bathrooms: 2,
      direction: 'Đông Nam',
      balconyDirection: 'Đông Nam',
      furniture: 'Đầy đủ nội thất cao cấp',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_fcoavz.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_nxasah.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_oxzlmk.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_mzeggd.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_ogugxw.jpg',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach360_ibwwrn.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu360_jgy5gv.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc360_qaposf.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep360_stclk9.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong360_m3kk7y.jpg',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=vinhomes-3pn',
      amenities: [
        'Bể bơi',
        'Phòng gym',
        'Công viên',
        'Bảo vệ 24/7',
        'Siêu thị',
      ],
      status: 'available',
      isVerified: true,
      landlordId: savedIndividualLandlord._id.toHexString(),
      projectId: null,
      projectName: null,
    })
    const savedApartment3 = await apartmentRepository.save(apartment3)
    logger.log(`Tạo căn hộ 3 thành công: ${savedApartment3.title}`)

    // Căn hộ 4 (Masteri Thảo Điền)
    const apartment4 = apartmentRepository.create({
      title: 'Masteri Thảo Điền - Căn hộ 2PN #T5-1204',
      category: 'Chung cư',
      description:
        'Căn hộ Masteri Thảo Điền thiết kế trẻ trung, view hồ bơi mát mẻ.',
      location: 'Quận 2, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Quận 2',
      ward: 'Phường Thảo Điền',
      street: 'Xa lộ Hà Nội',
      address: 'Masteri Thảo Điền, 159 Xa lộ Hà Nội, Thảo Điền, Quận 2, TP.HCM',
      priceMonthly: 20000000,
      area: 70,
      bedrooms: 2,
      bathrooms: 2,
      direction: 'Tây Nam',
      balconyDirection: 'Tây Nam',
      furniture: 'Đầy đủ nội thất cao cấp',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_cowdkj.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_nhbwq4.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/tam_cixnnt.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_azxf1o.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_tm8rba.jpg',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach360_dnj22r.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu360_jfrqe9.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc360_ulm1s7.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep360_jzvxtv.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong360_az2nc6.jpg',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=masteri-2pn',
      amenities: ['Bể bơi', 'Phòng gym', 'Khu BBQ', 'Bảo vệ 24/7'],
      status: 'available',
      isVerified: true,
      landlordId: savedLandlord._id.toHexString(),
      projectId: savedProject2._id.toHexString(),
      projectName: savedProject2.name,
    })
    const savedApartment4 = await apartmentRepository.save(apartment4)
    logger.log(`Tạo căn hộ 4 thành công: ${savedApartment4.title}`)

    // Căn hộ 5 (Masteri Thảo Điền)
    const apartment5 = apartmentRepository.create({
      title: 'Masteri Thảo Điền - Penthouse #T1-4201',
      category: 'Chung cư',
      description:
        'Căn hộ Penthouse thông tầng siêu sang tại Masteri Thảo Điền, sân vườn riêng.',
      location: 'Quận 2, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Quận 2',
      ward: 'Phường Thảo Điền',
      street: 'Xa lộ Hà Nội',
      address: 'Masteri Thảo Điền, 159 Xa lộ Hà Nội, Thảo Điền, Quận 2, TP.HCM',
      priceMonthly: 45000000,
      area: 150,
      bedrooms: 3,
      bathrooms: 3,
      direction: 'Đông Bắc',
      balconyDirection: 'Đông Bắc',
      furniture: 'Độc bản thiết kế hoàng gia',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_b7f9qg.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_vnqyxo.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_nix43e.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_vu4j8l.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_glrxsz.jpg',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach360_oiq234.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu360_xmcens.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc360_qxxrqg.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep360_j6w5yg.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong360_jlltqm.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=masteri-penthouse',
      amenities: ['Bể bơi riêng', 'Phòng gym', 'Sân vườn riêng', 'Bảo vệ 24/7'],
      status: 'available',
      isVerified: true,
      landlordId: savedIndividualLandlord._id.toHexString(),
      projectId: null,
      projectName: null,
    })
    const savedApartment5 = await apartmentRepository.save(apartment5)
    logger.log(`Tạo căn hộ 5 thành công: ${savedApartment5.title}`)

    // Căn hộ 6 (Vinhomes Central Park - Căn 6)
    const apartment6 = apartmentRepository.create({
      title: 'Vinhomes Central Park - Căn hộ 2PN #Park3-1502',
      category: 'Chung cư',
      description:
        'Căn hộ 2 phòng ngủ Vinhomes Central Park sang trọng, phòng khách rộng rãi, view công viên 14ha mát mẻ.',
      location: 'Bình Thạnh, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Bình Thạnh',
      ward: 'Phường 22',
      street: 'Nguyễn Hữu Cảnh',
      address:
        'Vinhomes Central Park, 208 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
      priceMonthly: 21000000,
      area: 78,
      bedrooms: 2,
      bathrooms: 2,
      direction: 'Đông Nam',
      balconyDirection: 'Đông Nam',
      furniture: 'Đầy đủ nội thất cao cấp',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_m6yoyy.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_tewd5h.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_at9jmg.jpg',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_fa9fo6.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_jjrsl8.jpg',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_360_zgkgz1.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_360_wj6idg.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_360_ulhe3y.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_360_ralifx.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_360_buoz0m.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=vinhomes-can6',
      amenities: [
        'Bể bơi',
        'Phòng gym',
        'Công viên',
        'Bảo vệ 24/7',
        'Siêu thị',
      ],
      status: 'available',
      isVerified: true,
      landlordId: savedLandlord._id.toHexString(),
      projectId: savedProject1._id.toHexString(),
      projectName: savedProject1.name,
    })
    const savedApartment6 = await apartmentRepository.save(apartment6)
    logger.log(`Tạo căn hộ 6 thành công: ${savedApartment6.title}`)

    // Căn hộ 7 (Masteri Thảo Điền - Căn 7)
    const apartment7 = apartmentRepository.create({
      title: 'Masteri Thảo Điền - Căn hộ 2PN #T3-2208',
      category: 'Chung cư',
      description:
        'Căn hộ Masteri Thảo Điền 2 phòng ngủ hiện đại, thiết kế tinh tế, ban công view sông Sài Gòn tuyệt đẹp.',
      location: 'Quận 2, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Quận 2',
      ward: 'Phường Thảo Điền',
      street: 'Xa lộ Hà Nội',
      address: 'Masteri Thảo Điền, 159 Xa lộ Hà Nội, Thảo Điền, Quận 2, TP.HCM',
      priceMonthly: 22000000,
      area: 72,
      bedrooms: 2,
      bathrooms: 2,
      direction: 'Nam',
      balconyDirection: 'Nam',
      furniture: 'Đầy đủ nội thất cao cấp',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_ddzvsd.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_hjvwkd.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_z8bhkt.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_upz5z1.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_bg8wja.png',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach360_r4h9dp.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu360_lveyyl.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc360_u2ucil.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep360_p6zrbh.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong360_mnzg48.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=masteri-can7',
      amenities: ['Bể bơi', 'Phòng gym', 'Khu BBQ', 'Bảo vệ 24/7'],
      status: 'available',
      isVerified: true,
      landlordId: savedLandlord._id.toHexString(),
      projectId: savedProject2._id.toHexString(),
      projectName: savedProject2.name,
    })
    const savedApartment7 = await apartmentRepository.save(apartment7)
    logger.log(`Tạo căn hộ 7 thành công: ${savedApartment7.title}`)

    // Căn hộ 8 (Sunrise City - Căn 8)
    const apartment8 = apartmentRepository.create({
      title: 'Sunrise City - Căn hộ 3PN #W1-1804',
      category: 'Chung cư',
      description:
        'Căn hộ 3 phòng ngủ Sunrise City Quận 7 thiết kế sang trọng, view toàn cảnh khu Nam Sài Gòn.',
      location: 'Quận 7, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Quận 7',
      ward: 'Phường Tân Hưng',
      street: 'Nguyễn Hữu Thọ',
      address:
        'Sunrise City, 23 Nguyễn Hữu Thọ, Phường Tân Hưng, Quận 7, TP.HCM',
      priceMonthly: 25000000,
      area: 105,
      bedrooms: 3,
      bathrooms: 2,
      direction: 'Tây Nam',
      balconyDirection: 'Tây Nam',
      furniture: 'Nội thất nhập khẩu',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_ukzdy7.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_ddp9sf.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_vb8h9p.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_qdqewy.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_fszsqa.png',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach360_x49014.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu360_zx5qvn.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc360_lk9xeb.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep360_pt02yb.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong360_xyarqd.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=sunrisecity-can8',
      amenities: [
        'Bể bơi',
        'Phòng gym',
        'Bãi đỗ xe',
        'Bảo vệ 24/7',
        'Siêu thị',
      ],
      status: 'available',
      isVerified: true,
      landlordId: savedIndividualLandlord._id.toHexString(),
      projectId: null,
      projectName: null,
    })
    const savedApartment8 = await apartmentRepository.save(apartment8)
    logger.log(`Tạo căn hộ 8 thành công: ${savedApartment8.title}`)

    // Căn hộ 9 (Vinhomes Smart City - Căn 9)
    const apartment9 = apartmentRepository.create({
      title: 'Vinhomes Smart City - Căn hộ 2PN+ #S2-0915',
      category: 'Chung cư',
      description:
        'Căn hộ 2 phòng ngủ thông minh Vinhomes Smart City thiết kế không gian tối ưu, thoáng mát.',
      location: 'Nam Từ Liêm, Hà Nội',
      city: 'Hà Nội',
      district: 'Nam Từ Liêm',
      ward: 'Phường Tây Mỗ',
      street: 'Đại Lộ Thăng Long',
      address:
        'Vinhomes Smart City, Đại Lộ Thăng Long, Phường Tây Mỗ, Nam Từ Liêm, Hà Nội',
      priceMonthly: 14500000,
      area: 65,
      bedrooms: 2,
      bathrooms: 1,
      direction: 'Đông Bắc',
      balconyDirection: 'Đông Bắc',
      furniture: 'Đầy đủ nội thất hiện đại',
      moveInTime: 'Ngay lập tức',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      gallery: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach_ngse9d.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu_z18iub.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc_ymnhrp.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep_cngirw.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong_neh2ki.png',
      ],
      images360: [
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/khach360_ogkpn4.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/ngu360_nfm3jh.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/wc360_zc19j2.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bep360_vjjqcw.png',
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/seed/bancong360_ditvgk.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=smartcity-can9',
      amenities: ['Bể bơi', 'Phòng gym', 'Công viên', 'Bảo vệ 24/7'],
      status: 'available',
      isVerified: true,
      landlordId: savedIndividualLandlord._id.toHexString(),
      projectId: null,
      projectName: null,
    })
    const savedApartment9 = await apartmentRepository.save(apartment9)
    logger.log(`Tạo căn hộ 9 thành công: ${savedApartment9.title}`)

    // 6. Tạo Hợp đồng mẫu
    logger.log('Đang tạo hợp đồng mẫu...')
    await contractRepository.delete({
      landlordId: savedLandlord._id.toHexString(),
      tenantId: savedTenant._id.toHexString(),
    })

    const contract = contractRepository.create({
      contractCode: 'HD-VINHOMES-102',
      propertyId: savedApartment1._id.toHexString(),
      propertyTitle: savedApartment1.title,
      propertyAddress: savedApartment1.address,
      propertyArea: savedApartment1.area,
      propertyFurniture: savedApartment1.furniture,
      propertyValue: 360000000, // 18m * 20 tháng
      landlordId: savedLandlord._id.toHexString(),
      landlordName: savedLandlord.fullName,
      landlordCccd: '012093005678',
      landlordAddress: '100 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
      tenantId: savedTenant._id.toHexString(),
      tenantName: savedTenant.fullName,
      tenantCccd: '038096001234',
      tenantAddress: '720A Điện Biên Phủ, Phường 22, Bình Thạnh, TP.HCM',
      startDate: new Date('2026-06-15'),
      endDate: new Date('2027-06-15'),
      monthlyRent: 18000000,
      deposit: 18000000,
      paymentDay: 5,
      latePenaltyRate: 20,
      terminationNoticeDays: 30,
      status: 'awaiting-signature',
      signedByTenant: false,
      signedByLandlord: false,
      contractHash: null,
      blockchainAddress: null,
      appliedPolicies: null,
    })
    await contractRepository.save(contract)
    logger.log('Tạo hợp đồng mẫu thành công!')

    // 7. Khởi tạo dữ liệu lịch sử huấn luyện AI (Recommendation History)
    const historyCount = await historyRepository.count()
    if (historyCount === 0) {
      logger.log('Đang nạp dữ liệu lịch sử thuê nhà cho AI Naive Bayes...')
      const csvPath = path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        'python',
        'apartment-recommendation',
        'dataset',
        'rental_history.csv'
      )
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim() !== '')
        const recordsToInsert: Partial<RecommendationHistory>[] = []

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

        const batchSize = 1000
        for (let i = 0; i < recordsToInsert.length; i += batchSize) {
          const batch = recordsToInsert.slice(i, i + batchSize)
          await historyRepository.saveAll(batch)
        }
        logger.log(
          `Nạp thành công ${recordsToInsert.length} bản ghi lịch sử thuê nhà vào MongoDB!`
        )
      } else {
        logger.warn('Không tìm thấy tệp rental_history.csv để nạp dữ liệu AI.')
      }
    } else {
      logger.log(`Đã có ${historyCount} bản ghi lịch sử AI, bỏ qua nạp lại.`)
    }

    logger.log('Database Seeding hoàn tất thành công!')
  } catch (error) {
    logger.error('Database Seeding thất bại!', error)
  } finally {
    await app.close()
  }
}

void bootstrap()
