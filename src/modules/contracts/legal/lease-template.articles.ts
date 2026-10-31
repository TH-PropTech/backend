import { DEPOSIT_REFUND_DUE_TEXT } from '../../rental/utils/deposit-refund.constants'

/**
 * 12 điều của hợp đồng thuê căn hộ (mẫu v2). Nội dung dùng biến {{...}} do
 * ContractDocumentProjector điền; số tiền đã kèm "bằng chữ". Bên A là Bên cho thuê,
 * Bên B là Bên thuê. Chỉ trích dẫn các điều luật đã đối chiếu; phần còn lại dẫn theo
 * văn bản ("theo quy định của pháp luật") để không ghi sai số điều.
 */
export type LeaseArticleDefinition = readonly [
  heading: string,
  content: string,
  variableRefs: readonly string[],
]

export const LEASE_ARTICLE_DEFINITIONS: readonly LeaseArticleDefinition[] = [
  [
    'Đối tượng hợp đồng và thông tin nhà ở cho thuê',
    [
      '1. Bên A đồng ý cho Bên B thuê và Bên B đồng ý thuê căn hộ chung cư có thông tin dưới đây (sau đây gọi là "nhà ở thuê") để sử dụng vào mục đích để ở:',
      '  a) Tên căn hộ: {{property}};',
      '  b) Địa chỉ: {{propertyAddress}};',
      '  c) Diện tích: {{propertyArea}};',
      '  d) Trang thiết bị, nội thất và tài sản kèm theo: {{propertyFurniture}}, được liệt kê chi tiết và xác nhận tình trạng tại Phụ lục 1 (Biên bản bàn giao hiện trạng) và Phụ lục 2 (Danh mục thiết bị, nội thất).',
      '2. Bên A cam kết là chủ sở hữu hoặc là người có quyền cho thuê hợp pháp đối với nhà ở thuê; nhà ở thuê không có tranh chấp, không bị kê biên để thi hành án và không thuộc diện đã bị cơ quan có thẩm quyền thu hồi hoặc phá dỡ tại thời điểm ký hợp đồng.',
      '3. Bên A cam kết nhà ở thuê bảo đảm chất lượng, an toàn để ở; hệ thống điện, cấp thoát nước và phòng cháy chữa cháy vận hành bình thường tại thời điểm bàn giao.',
      '4. Bên A có nghĩa vụ cung cấp trung thực các thông tin về tình trạng pháp lý và hiện trạng của nhà ở thuê. Mọi thiệt hại do cung cấp thông tin không chính xác do Bên A chịu trách nhiệm.',
    ].join('\n'),
    ['property', 'propertyAddress', 'propertyArea', 'propertyFurniture'],
  ],
  [
    'Thời hạn thuê, thời điểm bàn giao và gia hạn',
    [
      '1. Thời hạn thuê là {{durationMonths}} tháng, tính từ ngày {{startDate}} đến hết ngày {{endDate}}.',
      '2. Bên A bàn giao nhà ở thuê cho Bên B vào ngày {{startDate}}, sau khi Bên B đã thực hiện đầy đủ nghĩa vụ đặt cọc theo Điều 5. Việc bàn giao được lập thành Biên bản bàn giao (Phụ lục 1), có chữ ký của hai Bên, ghi rõ chỉ số công tơ điện, nước và tình trạng thiết bị.',
      '3. Nếu một Bên muốn gia hạn hợp đồng, Bên đó phải thông báo bằng văn bản cho Bên kia trước ngày hết hạn ít nhất {{terminationNoticeDays}} ngày. Việc gia hạn chỉ có hiệu lực khi hai Bên thỏa thuận bằng văn bản (phụ lục hoặc hợp đồng mới). Trong cùng điều kiện, Bên B được ưu tiên thuê tiếp.',
      '4. Nếu hết hạn mà Bên B vẫn tiếp tục sử dụng nhà ở thuê và Bên A không phản đối trong thời hạn hợp lý thì hai Bên phải làm thủ tục gia hạn; trong thời gian chưa hoàn tất, các điều khoản của hợp đồng này tiếp tục được áp dụng.',
    ].join('\n'),
    ['durationMonths', 'startDate', 'endDate', 'terminationNoticeDays'],
  ],
  [
    'Giá thuê và các chi phí liên quan',
    [
      '1. Giá thuê nhà ở là {{monthlyRent}} một tháng.',
      '2. Giá thuê nói trên chưa bao gồm: chi phí quản lý vận hành nhà chung cư; chi phí điện, nước sinh hoạt; dịch vụ truyền hình, internet, viễn thông; phí trông giữ xe và các dịch vụ khác do Bên B sử dụng. Các chi phí này do Bên B trực tiếp thanh toán cho ban quản lý tòa nhà hoặc đơn vị cung cấp dịch vụ theo mức tiêu thụ thực tế và đơn giá hiện hành.',
      '3. Thuế và nghĩa vụ tài chính phát sinh từ việc cho thuê (nếu có) do Bên A kê khai, nộp theo quy định của pháp luật.',
      '4. Giá thuê được giữ ổn định trong suốt thời hạn thuê. Mọi điều chỉnh giá thuê chỉ có hiệu lực khi hai Bên thỏa thuận bằng văn bản trước khi áp dụng.',
    ].join('\n'),
    ['monthlyRent'],
  ],
  [
    'Phương thức và thời hạn thanh toán',
    [
      '1. Bên B thanh toán tiền thuê hằng tháng, chậm nhất vào ngày {{paymentDay}} của mỗi tháng, bằng đồng Việt Nam (VNĐ) qua chuyển khoản ngân hàng hoặc thanh toán trực tuyến trên nền tảng TH-PropTech.',
      '2. Mỗi khoản thanh toán thành công trên nền tảng được lưu vết và cấp biên nhận điện tử; biên nhận này là chứng từ thanh toán hợp lệ giữa hai Bên.',
      '3. Trường hợp Bên B thanh toán bằng phương thức khác, hai Bên lập biên nhận có chữ ký xác nhận của người nhận tiền.',
      '4. Bên A có nghĩa vụ xuất chứng từ hoặc xác nhận đã nhận tiền khi Bên B yêu cầu.',
    ].join('\n'),
    ['paymentDay'],
  ],
  [
    'Đặt cọc bảo đảm thực hiện hợp đồng',
    [
      '1. Để bảo đảm thực hiện hợp đồng này, Bên B đặt cọc cho Bên A số tiền {{deposit}}, theo quy định về đặt cọc tại Điều 328 Bộ luật Dân sự 2015 và theo Thỏa thuận đặt cọc tại Phụ lục 4.',
      '2. Tiền đặt cọc không được dùng để trừ vào tiền thuê hằng tháng, trừ khi hai Bên có thỏa thuận khác bằng văn bản.',
      `3. Tiền đặt cọc do Bên A giữ và được hoàn trả trực tiếp cho Bên B; nền tảng không nhận, không giữ và không chuyển tiền đặt cọc. Khi hợp đồng được thực hiện đúng, Bên A hoàn trả tiền đặt cọc cho Bên B trong thời hạn ${DEPOSIT_REFUND_DUE_TEXT} kể từ ngày bảng khấu trừ tiền cọc được Bên B chấp nhận hoặc được xem là đã chấp nhận theo khoản 4 Điều 9, sau khi khấu trừ các khoản Bên B còn nợ (tiền thuê, chi phí dịch vụ) và chi phí khắc phục hư hỏng do lỗi của Bên B (nếu có) có chứng từ hợp lệ. Số ngày trong hợp đồng này tính theo ngày dương lịch.`,
      '4. Nếu Bên B từ chối giao kết hoặc đơn phương chấm dứt hợp đồng trái quy định thì mất khoản tiền đặt cọc; nếu Bên A từ chối giao kết hoặc đơn phương chấm dứt hợp đồng trái quy định thì phải hoàn trả khoản tiền đặt cọc và bồi thường cho Bên B một khoản tiền tương đương khoản đặt cọc, trừ khi hai Bên có thỏa thuận khác.',
    ].join('\n'),
    ['deposit'],
  ],
  [
    'Quyền và nghĩa vụ của Bên cho thuê (Bên A)',
    [
      '1. Quyền của Bên A:',
      '  a) Nhận đủ tiền thuê đúng hạn và đúng phương thức đã thỏa thuận;',
      '  b) Yêu cầu Bên B sử dụng nhà ở thuê đúng mục đích, đúng công năng và bảo quản tài sản như đã bàn giao;',
      '  c) Yêu cầu Bên B sửa chữa hoặc bồi thường thiệt hại đối với hư hỏng do lỗi của Bên B hoặc người sử dụng cùng Bên B gây ra;',
      '  d) Kiểm tra tình trạng nhà ở thuê định kỳ hoặc khi cần thiết, với điều kiện báo trước cho Bên B ít nhất 24 giờ (trừ trường hợp khẩn cấp để ngăn chặn thiệt hại), không làm ảnh hưởng đến sinh hoạt bình thường của Bên B;',
      '  đ) Đơn phương chấm dứt hợp đồng khi Bên B vi phạm nghiêm trọng nghĩa vụ theo Điều 11;',
      '  e) Nhận lại nhà ở thuê khi hết hạn hoặc khi hợp đồng chấm dứt.',
      '2. Nghĩa vụ của Bên A:',
      '  a) Bàn giao nhà ở thuê đúng thời hạn, đúng hiện trạng và hướng dẫn Bên B sử dụng các thiết bị, hệ thống kỹ thuật;',
      '  b) Bảo đảm quyền sử dụng ổn định, trọn vẹn của Bên B đối với nhà ở thuê trong suốt thời hạn thuê;',
      '  c) Bảo trì, sửa chữa các hư hỏng thuộc kết cấu và hệ thống kỹ thuật chung không do lỗi của Bên B gây ra, trong thời hạn hợp lý kể từ khi nhận được thông báo của Bên B;',
      '  d) Không được tự ý vào nhà ở thuê, thay đổi khóa hoặc cắt, ngừng cung cấp điện, nước, dịch vụ khi chưa có căn cứ theo hợp đồng;',
      '  đ) Hỗ trợ Bên B thực hiện thủ tục đăng ký tạm trú theo quy định của Luật Cư trú 2020;',
      '  e) Thực hiện nghĩa vụ thuế và các nghĩa vụ tài chính khác phát sinh từ việc cho thuê theo quy định của pháp luật;',
      '  g) Bồi thường thiệt hại thực tế do lỗi của mình gây ra cho Bên B.',
    ].join('\n'),
    [],
  ],
  [
    'Quyền và nghĩa vụ của Bên thuê (Bên B)',
    [
      '1. Quyền của Bên B:',
      '  a) Nhận bàn giao nhà ở thuê đúng thời hạn, hiện trạng và danh mục tài sản đã thỏa thuận;',
      '  b) Được sử dụng nhà ở thuê ổn định, được sử dụng các tiện ích chung của tòa nhà theo nội quy (Phụ lục 3);',
      '  c) Yêu cầu Bên A sửa chữa kịp thời các hư hỏng thuộc trách nhiệm của Bên A; nếu Bên A không thực hiện sau khi đã được thông báo hợp lý, Bên B được tự sửa chữa và yêu cầu Bên A hoàn trả chi phí hợp lý có chứng từ;',
      '  d) Được tiếp tục thuê theo các điều kiện của hợp đồng này nếu nhà ở thuê thay đổi chủ sở hữu;',
      '  đ) Đơn phương chấm dứt hợp đồng khi Bên A vi phạm nghiêm trọng nghĩa vụ theo Điều 11;',
      '  e) Yêu cầu Bên A bồi thường thiệt hại thực tế do lỗi của Bên A gây ra.',
      '2. Nghĩa vụ của Bên B:',
      '  a) Thanh toán đủ tiền thuê, tiền đặt cọc và các chi phí dịch vụ đúng hạn theo Điều 3, Điều 4 và Điều 5;',
      '  b) Sử dụng nhà ở thuê đúng mục đích để ở, đúng công năng thiết kế; bảo quản nhà ở và tài sản kèm theo như tài sản của chính mình;',
      '  c) Không tự ý sửa chữa, cải tạo, thay đổi kết cấu hoặc cho thuê lại một phần hay toàn bộ nhà ở thuê nếu chưa có văn bản đồng ý của Bên A;',
      '  d) Tuân thủ nội quy tòa nhà, quy định về an ninh trật tự và phòng cháy chữa cháy; đăng ký tạm trú theo quy định của Luật Cư trú 2020;',
      '  đ) Sửa chữa hoặc bồi thường đối với hư hỏng do lỗi của mình hoặc của người cùng sử dụng gây ra;',
      '  e) Trả lại nhà ở thuê đúng thời hạn, đúng hiện trạng khi hết hạn hoặc chấm dứt hợp đồng, trừ hao mòn tự nhiên hợp lý.',
    ].join('\n'),
    [],
  ],
  [
    'Sử dụng, bảo trì và sửa chữa nhà ở thuê',
    [
      '1. Nhà ở thuê chỉ được sử dụng để ở. Bên B không được sử dụng vào mục đích kinh doanh, sản xuất, lưu trú ngắn ngày cho khách du lịch hoặc hoạt động trái pháp luật; không tàng trữ vũ khí, chất cháy nổ, chất độc hại, chất ma túy hoặc hàng cấm.',
      '2. Số người sử dụng nhà ở thuê do hai Bên thỏa thuận, bảo đảm phù hợp diện tích và quy định của tòa nhà. Bên B đăng ký danh sách người cùng ở với Bên A và ban quản lý tòa nhà.',
      '3. Việc bảo trì, sửa chữa được phân chia như sau:',
      '  a) Bên A chịu trách nhiệm và chi phí đối với hư hỏng kết cấu, hệ thống kỹ thuật và thiết bị hao mòn tự nhiên không do lỗi của Bên B;',
      '  b) Bên B chịu trách nhiệm và chi phí đối với các sửa chữa nhỏ trong sinh hoạt hằng ngày và hư hỏng do lỗi của Bên B hoặc người cùng sử dụng.',
      '4. Khi phát hiện hư hỏng cần sửa chữa, mỗi Bên phải thông báo kịp thời cho Bên kia; Bên nào chậm thông báo làm thiệt hại tăng thêm thì chịu trách nhiệm về phần thiệt hại tăng thêm đó.',
      '5. Mọi cải tạo, lắp đặt thêm thiết bị cố định phải có văn bản đồng ý trước của Bên A; khi hết hạn, Bên B hoàn trả hiện trạng ban đầu nếu hai Bên không có thỏa thuận khác.',
    ].join('\n'),
    [],
  ],
  [
    'Bàn giao và hoàn trả nhà ở thuê',
    [
      '1. Khi bàn giao, hai Bên cùng kiểm tra và ghi nhận tình trạng nhà ở, chỉ số công tơ điện, nước và danh mục tài sản vào Biên bản bàn giao (Phụ lục 1, Phụ lục 2). Bên B có quyền phản hồi sai lệch bằng văn bản trong thời hạn 03 (ba) ngày kể từ ngày nhận bàn giao.',
      '2. Khi hợp đồng hết hạn hoặc chấm dứt, Bên B bàn giao lại nhà ở thuê và tài sản kèm theo trong tình trạng như khi nhận bàn giao, trừ hao mòn tự nhiên, đồng thời thanh toán đầy đủ các khoản còn nợ.',
      '3. Khi Bên B trả nhà, Bên A lập biên bản trả nhà ghi chỉ số công tơ điện, nước, số chìa khóa và tình trạng tài sản, đối chiếu với biên bản nhận nhà. Bên B có {{moveOutResponseDays}} ngày kể từ ngày nhận được biên bản để xác nhận hoặc phản đối. Quá thời hạn này mà Bên B không phản hồi thì được xem là Bên B đồng ý với biên bản.',
      '4. Sau khi biên bản trả nhà hoàn tất, Bên A lập bảng khấu trừ tiền cọc, nêu rõ lý do, số tiền và chứng từ của từng khoản; tổng các khoản khấu trừ không vượt quá tiền đặt cọc. Bên B có {{moveOutResponseDays}} ngày kể từ ngày nhận được bảng khấu trừ để chấp nhận hoặc phản đối từng khoản. Quá thời hạn này mà Bên B không phản hồi thì được xem là Bên B chấp nhận bảng khấu trừ.',
      '5. Bên A hoàn trả tiền đặt cọc trực tiếp cho Bên B trong thời hạn nêu tại khoản 3 Điều 5 và ghi nhận việc đã hoàn trên hệ thống. Bản ghi "đã hoàn" là lời khai của Bên A và được Bên B xác nhận đã nhận; nền tảng không bảo đảm khoản tiền được hoàn trả.',
      '6. Khi hai Bên không thống nhất về biên bản trả nhà hoặc bảng khấu trừ, mỗi Bên có quyền yêu cầu ghi nhận tranh chấp trên hệ thống. Nền tảng không phân xử; hai Bên giải quyết theo Điều 12.',
      '7. Nếu Bên B không bàn giao lại nhà ở thuê đúng hạn, Bên B phải trả tiền thuê cho thời gian chậm trả theo mức giá thuê quy định tại Điều 3, và chịu trách nhiệm đối với các thiệt hại phát sinh (nếu có).',
    ].join('\n'),
    ['moveOutResponseDays'],
  ],
  [
    'Vi phạm hợp đồng, lãi chậm trả và bồi thường thiệt hại',
    [
      '1. Bên nào vi phạm nghĩa vụ theo hợp đồng thì phải chịu trách nhiệm theo Điều 351 Bộ luật Dân sự 2015, bao gồm việc khắc phục vi phạm và bồi thường thiệt hại thực tế.',
      '2. Trường hợp Bên B chậm thanh toán tiền thuê hoặc các khoản đến hạn, Bên B phải trả lãi đối với số tiền chậm trả tương ứng với thời gian chậm trả theo mức {{latePenaltyRate}}%/năm, nhưng không vượt mức lãi suất tối đa mà pháp luật cho phép theo Điều 468 Bộ luật Dân sự 2015.',
      '3. Bên bị vi phạm có nghĩa vụ thông báo bằng văn bản về hành vi vi phạm và cho Bên vi phạm một thời hạn hợp lý (tối thiểu 07 ngày) để khắc phục, trừ trường hợp vi phạm không thể khắc phục.',
      '4. Bên bị thiệt hại phải áp dụng các biện pháp cần thiết, hợp lý để hạn chế thiệt hại; phần thiệt hại do không áp dụng biện pháp hạn chế thì không được bồi thường.',
      '5. Việc bồi thường thiệt hại phải có căn cứ, chứng từ hợp lệ và chỉ tính cho thiệt hại thực tế, trực tiếp phát sinh từ hành vi vi phạm.',
    ].join('\n'),
    ['latePenaltyRate'],
  ],
  [
    'Chấm dứt hợp đồng và sự kiện bất khả kháng',
    [
      '1. Hợp đồng chấm dứt trong các trường hợp sau:',
      '  a) Hết thời hạn thuê theo Điều 2 mà hai Bên không gia hạn;',
      '  b) Hai Bên thỏa thuận chấm dứt bằng văn bản;',
      '  c) Một Bên đơn phương chấm dứt hợp đồng theo khoản 2 và khoản 3 Điều này;',
      '  d) Nhà ở thuê bị phá dỡ hoặc bị thu hồi theo quyết định của cơ quan nhà nước có thẩm quyền, hoặc không còn đáp ứng điều kiện an toàn để ở do nguyên nhân khách quan;',
      '  đ) Các trường hợp khác theo quy định của pháp luật.',
      '2. Bên A có quyền đơn phương chấm dứt hợp đồng khi Bên B: (i) chậm thanh toán tiền thuê quá 15 (mười lăm) ngày kể từ ngày đến hạn mà đã được nhắc bằng văn bản; (ii) sử dụng nhà ở sai mục đích hoặc cho thuê lại trái quy định; (iii) tự ý phá dỡ, cải tạo làm hư hỏng nghiêm trọng nhà ở thuê; hoặc (iv) vi phạm nghiêm trọng nội quy tòa nhà, gây mất an ninh trật tự đã được nhắc nhở mà không khắc phục.',
      '3. Bên B có quyền đơn phương chấm dứt hợp đồng khi Bên A: (i) không bàn giao nhà ở thuê đúng hạn mà không có lý do chính đáng; (ii) không bảo đảm quyền sử dụng ổn định hoặc nhà ở thuê có khiếm khuyết nghiêm trọng ảnh hưởng đến việc ở mà đã được thông báo nhưng không khắc phục; hoặc (iii) tự ý tăng giá thuê, đơn phương thay đổi điều kiện hợp đồng trái thỏa thuận.',
      '4. Ngoài các trường hợp tại khoản 2 và khoản 3, Bên nào muốn đơn phương chấm dứt hợp đồng trước hạn phải thông báo bằng văn bản cho Bên kia trước ít nhất {{terminationNoticeDays}} ngày. Việc đơn phương chấm dứt không đúng quy định là vi phạm hợp đồng và Bên vi phạm chịu trách nhiệm theo Điều 5 và Điều 10, đồng thời áp dụng quy định về đơn phương chấm dứt thực hiện hợp đồng tại Điều 428 Bộ luật Dân sự 2015.',
      '5. Sự kiện bất khả kháng là sự kiện xảy ra một cách khách quan không thể lường trước được và không thể khắc phục được mặc dù đã áp dụng mọi biện pháp cần thiết và khả năng cho phép (Điều 156 Bộ luật Dân sự 2015), như thiên tai, dịch bệnh, chiến tranh, quyết định của cơ quan nhà nước. Bên gặp sự kiện bất khả kháng không phải chịu trách nhiệm đối với phần nghĩa vụ không thực hiện được, với điều kiện phải thông báo cho Bên kia trong vòng 03 (ba) ngày làm việc kể từ khi xảy ra và cung cấp tài liệu chứng minh. Nếu sự kiện kéo dài quá 30 (ba mươi) ngày, mỗi Bên có quyền chấm dứt hợp đồng mà không bị coi là vi phạm.',
      '6. Khi hợp đồng chấm dứt, hai Bên thực hiện việc bàn giao, thanh toán và thanh lý theo Điều 5 và Điều 9.',
    ].join('\n'),
    ['terminationNoticeDays'],
  ],
  [
    'Giải quyết tranh chấp, hiệu lực và điều khoản chung',
    [
      '1. Mọi tranh chấp phát sinh từ hợp đồng này, trước hết được hai Bên giải quyết bằng thương lượng, hòa giải trên tinh thần thiện chí và hợp tác. Thời hạn thương lượng là 30 (ba mươi) ngày kể từ ngày một Bên có thông báo bằng văn bản về tranh chấp.',
      '2. Nếu thương lượng không thành, mỗi Bên có quyền khởi kiện tại Tòa án nhân dân có thẩm quyền theo quy định của pháp luật tố tụng dân sự.',
      '3. Hợp đồng có hiệu lực kể từ thời điểm cả hai Bên hoàn tất việc ký bằng chữ ký số hoặc chữ ký điện tử hợp lệ được ghi nhận trên nền tảng TH-PropTech. Hợp đồng được lập dưới dạng thông điệp dữ liệu và có giá trị pháp lý như văn bản giấy theo Luật Giao dịch điện tử 2023 (số 20/2023/QH15) và Bộ luật Dân sự 2015.',
      '4. Nội dung hợp đồng được khóa bằng mã xác thực nội dung và dấu vết ký, giao dịch được lưu để đối soát; mọi sửa đổi, bổ sung chỉ có hiệu lực khi được hai Bên đồng ý bằng phụ lục có chữ ký của cả hai Bên.',
      '5. Các Phụ lục (Phụ lục 1: Biên bản bàn giao; Phụ lục 2: Danh mục thiết bị, nội thất; Phụ lục 3: Nội quy tòa nhà; Phụ lục 4: Thỏa thuận đặt cọc) là bộ phận không tách rời của hợp đồng. Trường hợp có mâu thuẫn, nội dung hợp đồng này được ưu tiên áp dụng, trừ khi phụ lục được lập sau và nêu rõ việc sửa đổi.',
      '6. Việc một Điều khoản bị vô hiệu không làm ảnh hưởng đến hiệu lực của các điều khoản còn lại.',
      '7. Mỗi Bên cam kết đã đọc kỹ, hiểu rõ quyền và nghĩa vụ của mình, ký kết hoàn toàn tự nguyện, có đầy đủ năng lực hành vi dân sự và cùng thực hiện nghiêm chỉnh các nội dung đã thỏa thuận.',
    ].join('\n'),
    [],
  ],
]
