import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)
  private readonly apiKey = process.env.RESEND_API_KEY
  private readonly fromAddress = 'TH PropTech <onboarding@resend.dev>'

  /**
   * Gửi mã OTP xác nhận tới email người dùng
   */
  async sendOtpMail(
    toEmail: string,
    otpCode: string,
    actionName: string
  ): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(
        'RESEND_API_KEY chưa được cấu hình. Bỏ qua việc gửi email.'
      )
      return
    }

    const subject = `[TH PropTech] Mã OTP xác nhận ${actionName}`
    const htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e3d8d0; border-radius: 16px; background-color: #fffdf9; color: #2e2620;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #c65a3a; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">TH PropTech</h2>
          <p style="font-size: 12px; color: #8e7a6f; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 1.5px;">Nền tảng Quản lý Thuê Nhà Thông Minh</p>
        </div>
        
        <div style="border-bottom: 1px solid #e3d8d0; padding-bottom: 20px; margin-bottom: 20px;">
          <h3 style="font-size: 18px; margin: 0 0 12px 0; color: #4a3e3d;">Xin chào,</h3>
          <p style="font-size: 14px; line-height: 1.6; color: #5a4b49; margin: 0;">
            Bạn nhận được email này vì đã yêu cầu mã xác thực OTP để tiến hành <strong>${actionName}</strong> trên hệ thống của chúng tôi.
          </p>
        </div>

        <div style="text-align: center; background-color: #f7eedf; padding: 24px; border-radius: 12px; margin-bottom: 24px;">
          <span style="display: block; font-size: 12px; text-transform: uppercase; color: #8e7a6f; font-weight: bold; margin-bottom: 8px; letter-spacing: 1px;">Mã OTP của bạn</span>
          <span style="font-size: 32px; font-weight: 800; color: #c65a3a; letter-spacing: 6px; font-family: monospace;">${otpCode}</span>
          <span style="display: block; font-size: 12px; color: #a69285; margin-top: 10px;">(Có hiệu lực trong vòng 5 phút)</span>
        </div>

        <div style="font-size: 12px; color: #8e7a6f; line-height: 1.6; border-top: 1px solid #e3d8d0; padding-top: 20px;">
          <p style="margin: 0 0 8px 0;"><strong>Lưu ý:</strong> Vui lòng tuyệt đối không chia sẻ mã này với bất kỳ ai để đảm bảo an toàn tài khoản.</p>
          <p style="margin: 0;">Nếu không phải bạn thực hiện yêu cầu này, vui lòng bỏ qua email hoặc liên hệ bộ phận hỗ trợ của TH PropTech.</p>
        </div>
      </div>
    `

    await this.sendEmail(toEmail, subject, htmlBody)
  }

  /**
   * Gửi email chào mừng thành viên mới
   */
  async sendWelcomeMail(toEmail: string, fullName: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(
        'RESEND_API_KEY chưa được cấu hình. Bỏ qua việc gửi email.'
      )
      return
    }

    const subject = 'Chào mừng bạn đến với TH PropTech!'
    const htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e3d8d0; border-radius: 16px; background-color: #fffdf9; color: #2e2620;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #c65a3a; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">TH PropTech</h2>
          <p style="font-size: 12px; color: #8e7a6f; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 1.5px;">Nền tảng Quản lý Thuê Nhà Thông Minh</p>
        </div>
        
        <div style="border-bottom: 1px solid #e3d8d0; padding-bottom: 20px; margin-bottom: 20px;">
          <h3 style="font-size: 18px; margin: 0 0 12px 0; color: #4a3e3d;">Chào mừng ${fullName},</h3>
          <p style="font-size: 14px; line-height: 1.6; color: #5a4b49; margin: 0 0 12px 0;">
            Chúc mừng bạn đã đăng ký tài khoản thành công tại TH PropTech. Chúng tôi rất vinh hạnh được đồng hành cùng bạn trên hành trình giao dịch và thuê nhà thông minh.
          </p>
          <p style="font-size: 14px; line-height: 1.6; color: #5a4b49; margin: 0;">
            Hãy hoàn thành việc định danh cá nhân (eKYC) trên ứng dụng để mở khóa toàn bộ tính năng và bắt đầu tìm kiếm, ký kết hợp đồng thuê nhà điện tử bảo mật bằng công nghệ Blockchain.
          </p>
        </div>

        <div style="text-align: center; margin-bottom: 24px;">
          <a href="http://localhost:3000" style="display: inline-block; background-color: #c65a3a; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: bold; font-size: 14px;">Trải nghiệm ngay</a>
        </div>

        <div style="font-size: 12px; color: #8e7a6f; line-height: 1.6; border-top: 1px solid #e3d8d0; padding-top: 20px;">
          <p style="margin: 0;">Nếu cần hỗ trợ kỹ thuật hoặc có bất kỳ câu hỏi nào, vui lòng liên hệ ngay với chúng tôi qua email support@th-proptech.vn.</p>
        </div>
      </div>
    `

    await this.sendEmail(toEmail, subject, htmlBody)
  }

  /**
   * Gọi API Resend gửi email
   */
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
          `Gửi email qua Resend thất bại: ${response.status} - ${errText}`
        )
      } else {
        const result = (await response.json()) as { id: string }
        this.logger.log(`Gửi email thành công tới ${to}. ID: ${result.id}`)
      }
    } catch (error) {
      this.logger.error('Lỗi khi gọi API Resend gửi email:', error)
    }
  }
}
