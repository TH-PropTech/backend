import { Injectable, Logger } from '@nestjs/common'

export type ApartmentChangeListener = (apartmentId?: string) => Promise<void>

/**
 * Điểm thông báo duy nhất khi dữ liệu hiển thị công khai của căn hộ thay đổi.
 * Phía ghi chỉ gọi changed(); phía đọc (cache, read model) đăng ký lắng nghe.
 * Lỗi của listener không làm hỏng thao tác ghi đã hoàn tất.
 */
@Injectable()
export class ApartmentChangeNotifier {
  private readonly logger = new Logger(ApartmentChangeNotifier.name)
  private readonly listeners = new Set<ApartmentChangeListener>()

  subscribe(listener: ApartmentChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async changed(apartmentId?: string): Promise<void> {
    await Promise.all(
      [...this.listeners].map(async listener => {
        try {
          await listener(apartmentId)
        } catch (error) {
          this.logger.warn(
            `Apartment change listener failed: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      })
    )
  }
}
