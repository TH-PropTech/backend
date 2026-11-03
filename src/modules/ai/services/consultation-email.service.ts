import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class ConsultationEmailService {
  private readonly logger = new Logger(ConsultationEmailService.name)
  private readonly apiKey = process.env.RESEND_API_KEY || ''
  private readonly fromAddress = 'TH PropTech <noreply@th-proptech.store>'

  async sendInvitation(
    toEmail: string,
    logId: string,
    fullName: string
  ): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn('RESEND_API_KEY not configured. Skipping email.')
      return
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3001'
    const ctaUrl = `${appUrl}/api/v1/ai-consultation/chat-view?logId=${logId}`
    const subject = '[TH PropTech] Thư mời trải nghiệm Trợ lý ảo tư vấn căn hộ'
    const htmlBody = this.getInvitationHtml(fullName, ctaUrl)

    await this.sendEmail(toEmail, subject, htmlBody)
  }

  async sendSummary(
    toEmail: string,
    durationSeconds: number,
    recommendedPackage: string,
    notes: string
  ): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn('RESEND_API_KEY not configured. Skipping email.')
      return
    }

    const min = Math.floor(durationSeconds / 60)
    const sec = durationSeconds % 60
    const durationText = `${min} phút ${sec} giây`
    const subject = '[TH PropTech] Báo cáo tóm tắt tư vấn từ Trợ lý ảo AI'
    const htmlBody = this.getSummaryHtml(
      durationText,
      recommendedPackage,
      notes
    )

    await this.sendEmail(toEmail, subject, htmlBody)
  }

  private async sendEmail(
    to: string,
    subject: string,
    html: string
  ): Promise<void> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [to],
          subject,
          html,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        this.logger.error(
          `Resend send email failed: ${response.status} - ${errText}`
        )
      } else {
        this.logger.log(`Consultation email sent successfully to ${to}`)
      }
    } catch (error) {
      this.logger.error('Error sending consultation email via Resend:', error)
    }
  }

  private getInvitationHtml(fullName: string, ctaUrl: string): string {
    return `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e3d8d0; border-radius: 16px; background-color: #fffdf9; color: #2B211E; box-sizing: border-box;">
        <!-- Preheader text -->
        <span style="display: none; max-height: 0px; overflow: hidden;">Mời bạn trải nghiệm Trợ lý ảo AI đàm thoại bằng giọng nói để tìm thuê căn hộ nhanh chóng.</span>
        
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #c65a3a; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">TH PropTech</h2>
          <p style="font-size: 12px; color: #8e7a6f; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 1.5px;">Nền tảng Quản lý Thuê Nhà Thông Minh</p>
        </div>
        <div style="border-bottom: 1px solid #e3d8d0; padding-bottom: 20px; margin-bottom: 20px;">
          <h3 style="font-size: 18px; margin: 0 0 12px 0; color: #9F3F2A;">Xin chào ${fullName},</h3>
          <p style="font-size: 14px; line-height: 1.6; color: #5a4b49; margin: 0;">
            Chúng tôi trân trọng mời bạn trải nghiệm Trợ lý ảo AI thế hệ mới được tích hợp trên hệ thống TH PropTech. Trợ lý ảo hỗ trợ đàm thoại trực tiếp bằng giọng nói và tin nhắn văn bản để giúp bạn nhanh chóng chọn lựa căn hộ thuê phù hợp nhất.
          </p>
        </div>
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="${ctaUrl}" style="display: inline-block; background-color: #c65a3a; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px; border: 1px solid #9F3F2A;">Trò chuyện với Trợ lý AI</a>
        </div>
        <div style="font-size: 12px; color: #8e7a6f; line-height: 1.6; border-top: 1px solid #e3d8d0; padding-top: 20px;">
          <p style="margin: 0 0 8px 0;"><strong>Lưu ý:</strong> Link trải nghiệm có giá trị định danh phiên tư vấn của riêng bạn.</p>
          <p style="margin: 0 0 8px 0;">Nếu cần hỗ trợ thêm, vui lòng liên hệ hotline hoặc gửi phản hồi qua email support@th-proptech.vn.</p>
          <p style="margin: 0; font-size: 11px; color: #a49389;">Bạn nhận được thư này từ hệ thống TH PropTech. Nếu không muốn nhận email tương tự, bạn có thể <a href="#" style="color: #c65a3a; text-decoration: underline;">hủy đăng ký nhận thư</a>.</p>
        </div>
      </div>
    `
  }

  private getSummaryHtml(
    durationText: string,
    recommendedPackage: string,
    notes: string
  ): string {
    return `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e3d8d0; border-radius: 16px; background-color: #fffdf9; color: #2B211E; box-sizing: border-box;">
        <!-- Preheader text -->
        <span style="display: none; max-height: 0px; overflow: hidden;">Báo cáo tóm tắt cuộc đàm thoại tư vấn thuê căn hộ của bạn cùng Trợ lý ảo AI.</span>
        
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #c65a3a; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">TH PropTech</h2>
          <p style="font-size: 12px; color: #8e7a6f; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 1.5px;">Nền tảng Quản lý Thuê Nhà Thông Minh</p>
        </div>
        <div style="border-bottom: 1px solid #e3d8d0; padding-bottom: 20px; margin-bottom: 20px;">
          <h3 style="font-size: 18px; margin: 0 0 12px 0; color: #9F3F2A;">Tóm tắt kết quả tư vấn</h3>
          <p style="font-size: 14px; line-height: 1.6; color: #5a4b49; margin: 0;">
            Cảm ơn bạn đã trò chuyện cùng Trợ lý ảo AI của TH PropTech. Dưới đây là kết quả tư vấn của phiên đàm thoại vừa qua:
          </p>
        </div>
        <div style="background-color: #FAF7F2; padding: 20px; border-radius: 12px; margin-bottom: 24px; border: 1px solid #e3d8d0;">
          <p style="margin: 0 0 10px 0; font-size: 14px;"><strong>Thời lượng gọi:</strong> ${durationText}</p>
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #6B8E4E;"><strong>Căn hộ đề xuất:</strong> ${recommendedPackage || 'Đang cập nhật'}</p>
          <p style="margin: 0; font-size: 14px; line-height: 1.5;"><strong>Ghi chú tóm tắt:</strong> ${notes || 'Chưa có ghi chú'}</p>
        </div>
        <div style="font-size: 12px; color: #8e7a6f; line-height: 1.6; border-top: 1px solid #e3d8d0; padding-top: 20px;">
          <p style="margin: 0 0 8px 0;">Trợ lý AI đã ghi nhận nhu cầu của bạn và sẽ thông báo đến nhân viên vận hành để sớm sắp xếp lịch hẹn xem nhà thực tế.</p>
          <p style="margin: 0; font-size: 11px; color: #a49389;">Bạn nhận được thư này từ hệ thống TH PropTech. Nếu không muốn nhận email tương tự, bạn có thể <a href="#" style="color: #c65a3a; text-decoration: underline;">hủy đăng ký nhận thư</a>.</p>
        </div>
      </div>
    `
  }
}
