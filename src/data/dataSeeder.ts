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
import { Apartment } from '../modules/apartments/schemas/apartment.schema'
import { KycRecord } from '../modules/kyc/schemas/kyc-record.schema'
import { Contract } from '../modules/contracts/schemas/contract.schema'
import { Project } from '../modules/projects/schemas/project.schema'
import { Building } from '../modules/buildings/schemas/building.schema'
import { RecommendationHistory } from '../modules/recommendations/schemas/recommendation-history.schema'
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
    const kycRecordRepository = app.get<Repository<KycRecord>>(
      getRepositoryToken(KycRecord)
    )
    const contractRepository = app.get<Repository<Contract>>(
      getRepositoryToken(Contract)
    )
    const projectRepository = app.get<Repository<Project>>(
      getRepositoryToken(Project)
    )
    const buildingRepository = app.get<Repository<Building>>(
      getRepositoryToken(Building)
    )
    const historyRepository = app.get<Repository<RecommendationHistory>>(
      getRepositoryToken(RecommendationHistory)
    )

    // 1. Dọn dẹp dữ liệu mẫu cũ (Tùy chọn)
    logger.log('Đang dọn dẹp các dữ liệu mẫu cũ...')
    await buildingRepository.delete({})
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
    await kycRecordRepository.delete({
      userId: {
        $in: [savedLandlord._id.toHexString(), savedTenant._id.toHexString()],
      } as any,
    })

    const landlordKyc = kycRecordRepository.create({
      userId: savedLandlord._id.toHexString(),
      idCardNumber: '012093005678',
      fullName: 'LÊ HOÀNG MINH',
      dateOfBirth: '20/12/1985',
      placeOfResidence: '100 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
      status: 'verified',
      frontCardUrl: 'https://images.unsplash.com/photo-1554774853-719586f82d77',
      backCardUrl: 'https://images.unsplash.com/photo-1554774853-719586f82d77',
      selfieUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e',
      verifiedAt: new Date(),
      rejectedReason: null,
    })
    await kycRecordRepository.save(landlordKyc)

    const tenantKyc = kycRecordRepository.create({
      userId: savedTenant._id.toHexString(),
      idCardNumber: '038096001234',
      fullName: 'NGUYỄN VĂN A',
      dateOfBirth: '15/08/1996',
      placeOfResidence: '720A Điện Biên Phủ, Phường 22, Bình Thạnh, TP.HCM',
      status: 'verified',
      frontCardUrl: 'https://images.unsplash.com/photo-1554774853-719586f82d77',
      backCardUrl: 'https://images.unsplash.com/photo-1554774853-719586f82d77',
      selfieUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde',
      verifiedAt: new Date(),
      rejectedReason: null,
    })
    await kycRecordRepository.save(tenantKyc)
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

    // 4.5. Tạo các tòa nhà (Buildings) mẫu
    logger.log('Đang tạo các tòa nhà mẫu...')

    // Tòa nhà 1 thuộc Vinhomes Central Park
    const buildingLandmark = buildingRepository.create({
      name: 'Tòa Landmark 81',
      projectId: savedProject1._id.toHexString(),
      projectName: savedProject1.name,
      description:
        'Tòa nhà cao nhất Việt Nam, biểu tượng của sự thịnh vượng với đầy đủ tiện ích và trung tâm thương mại cao cấp.',
      floorsCount: 81,
      location: '208 Nguyễn Hữu Cảnh, Phường 22, Bình Thạnh, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Bình Thạnh',
      amenities: [
        'Bể bơi vô cực',
        'Phòng Gym',
        'TTTM Vincom Landmark 81',
        'Đài quan sát',
        'Bảo vệ 24/7',
      ],
      images: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781534819/toa1_fp0an5.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535081/toa1_matsau_kh18qu.png',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781534880/toa1360do_jq98uv.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535400/toa1360_matsau_f1jgyg.png',
      ],
    })
    const savedBuildingLandmark =
      await buildingRepository.save(buildingLandmark)

    // Tòa nhà 2 thuộc Masteri Thảo Điền
    const buildingMasteriT1 = buildingRepository.create({
      name: 'Tháp T1',
      projectId: savedProject2._id.toHexString(),
      projectName: savedProject2.name,
      description:
        'Tháp căn hộ dịch vụ và chung cư cao cấp thuộc dự án Masteri Thảo Điền.',
      floorsCount: 30,
      location: '159 Xa lộ Hà Nội, Thảo Điền, Quận 2, TP.HCM',
      city: 'Hồ Chí Minh',
      district: 'Quận 2',
      amenities: [
        'Hồ bơi cảnh quan',
        'Khu BBQ ngoài trời',
        'TTTM Vincom Mega Mall',
        'Phòng Gym hiện đại',
      ],
      images: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781575156/toa2_zgy1zk.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781575156/toa2_matsau_ykiog8.png',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781575206/toa2_360_pku65l.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781575195/toa2_matsau360_wc1nsa.png',
      ],
    })
    const savedBuildingMasteriT1 =
      await buildingRepository.save(buildingMasteriT1)
    logger.log('Tạo các tòa nhà mẫu thành công!')

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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535737/khach_ixjldr.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535739/ngu_nquhie.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535733/wc_or8yr0.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535735/bep_zea4ow.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535734/bancong_djmgni.jpg',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535852/khach360_qchdyn.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535875/ngu360_blmllu.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535870/wc360_trstwe.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535864/bep360_ehr4pr.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535871/bancong360_hq44xx.png',
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
      buildingId: savedBuildingLandmark._id.toHexString(),
      buildingName: savedBuildingLandmark.name,
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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535993/khach_ocrf14.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535995/ngu_byaar1.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535997/wc_c123nn.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535991/bep_p5omsl.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781535989/bancong_nr5xs1.jpg',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781536062/khach360_fbbffh.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781536055/ngu360_xrhtua.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781536056/wc360_jdfqtz.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781536060/bep360_wjj1wh.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781536058/bancong360_yohcri.jpg',
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
      buildingId: null,
      buildingName: null,
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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573526/khach_fcoavz.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573527/ngu_nxasah.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573526/wc_oxzlmk.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573527/bep_mzeggd.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573527/bancong_ogugxw.jpg',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573592/khach360_ibwwrn.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573593/ngu360_jgy5gv.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573594/wc360_qaposf.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573593/bep360_stclk9.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573592/bancong360_m3kk7y.jpg',
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
      buildingId: null,
      buildingName: null,
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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573725/khach_cowdkj.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781590576/ngu_nhbwq4.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573722/tam_cixnnt.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573724/bep_azxf1o.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573723/bancong_tm8rba.jpg',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573926/khach360_dnj22r.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573930/ngu360_jfrqe9.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573928/wc360_ulm1s7.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573924/bep360_jzvxtv.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781573925/bancong360_az2nc6.jpg',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=masteri-2pn',
      amenities: ['Bể bơi', 'Phòng gym', 'Khu BBQ', 'Bảo vệ 24/7'],
      status: 'available',
      isVerified: true,
      landlordId: savedLandlord._id.toHexString(),
      projectId: savedProject2._id.toHexString(),
      projectName: savedProject2.name,
      buildingId: savedBuildingMasteriT1._id.toHexString(),
      buildingName: savedBuildingMasteriT1.name,
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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574452/khach_b7f9qg.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574453/ngu_vnqyxo.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574453/wc_nix43e.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574507/bep_vu4j8l.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574456/bancong_glrxsz.jpg',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574671/khach360_oiq234.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574668/ngu360_xmcens.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574675/wc360_qxxrqg.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574670/bep360_j6w5yg.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1781574673/bancong360_jlltqm.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=masteri-penthouse',
      amenities: ['Bể bơi riêng', 'Phòng gym', 'Sân vườn riêng', 'Bảo vệ 24/7'],
      status: 'available',
      isVerified: true,
      landlordId: savedIndividualLandlord._id.toHexString(),
      projectId: null,
      projectName: null,
      buildingId: null,
      buildingName: null,
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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370603/khach_m6yoyy.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370658/ngu_tewd5h.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370642/wc_at9jmg.jpg',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370615/bep_fa9fo6.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370605/bancong_jjrsl8.jpg',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370756/khach_360_zgkgz1.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370736/ngu_360_wj6idg.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370741/wc_360_ulhe3y.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370743/bep_360_ralifx.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786370747/bancong_360_buoz0m.png',
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
      buildingId: savedBuildingLandmark._id.toHexString(),
      buildingName: savedBuildingLandmark.name,
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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371452/khach_ddzvsd.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371552/ngu_hjvwkd.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371493/wc_z8bhkt.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371513/bep_upz5z1.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371532/bancong_bg8wja.png',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371624/khach360_r4h9dp.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371615/ngu360_lveyyl.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371627/wc360_u2ucil.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371622/bep360_p6zrbh.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371618/bancong360_mnzg48.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=masteri-can7',
      amenities: ['Bể bơi', 'Phòng gym', 'Khu BBQ', 'Bảo vệ 24/7'],
      status: 'available',
      isVerified: true,
      landlordId: savedLandlord._id.toHexString(),
      projectId: savedProject2._id.toHexString(),
      projectName: savedProject2.name,
      buildingId: savedBuildingMasteriT1._id.toHexString(),
      buildingName: savedBuildingMasteriT1.name,
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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371997/khach_ukzdy7.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371995/ngu_ddp9sf.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371994/wc_vb8h9p.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786371991/bep_qdqewy.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372000/bancong_fszsqa.png',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372039/khach360_x49014.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372036/ngu360_zx5qvn.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372042/wc360_lk9xeb.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372045/bep360_pt02yb.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372048/bancong360_xyarqd.png',
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
      buildingId: null,
      buildingName: null,
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
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372514/khach_ngse9d.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372519/ngu_z18iub.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372522/wc_ymnhrp.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372512/bep_cngirw.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372516/bancong_neh2ki.png',
      ],
      images360: [
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372537/khach360_ogkpn4.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372540/ngu360_nfm3jh.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372546/wc360_zc19j2.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372543/bep360_vjjqcw.png',
        'https://res.cloudinary.com/dehsnaot1/image/upload/v1786372549/bancong360_ditvgk.png',
      ],
      vrUrl: 'https://my.matterport.com/show/?m=smartcity-can9',
      amenities: ['Bể bơi', 'Phòng gym', 'Công viên', 'Bảo vệ 24/7'],
      status: 'available',
      isVerified: true,
      landlordId: savedIndividualLandlord._id.toHexString(),
      projectId: null,
      projectName: null,
      buildingId: null,
      buildingName: null,
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
        'building-recommendation',
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
          const entities = historyRepository.create(batch)
          await historyRepository.save(entities)
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
