import { Module } from '@nestjs/common';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { CertificateTemplatesController } from './certificate-templates.controller';
import { CertificateTemplatesService } from './certificate-templates.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { QueueModule } from '../../common/queue/queue.module';
import { CertificatePdfProcessor } from './certificate-pdf.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExamsModule } from '../exams/exams.module';
import { CertificateShareController } from './certificate-share.controller';
import { CertificateShareService } from './certificate-share.service';

@Module({
  imports: [NotificationsModule, ExamsModule, QueueModule],
  controllers: [
    CertificateTemplatesController,
    CertificateShareController,
    CertificatesController,
  ],
  providers: [
    CertificatesService,
    CertificateTemplatesService,
    CertificatePdfService,
    CertificatePdfProcessor,
    CertificateShareService,
  ],
  exports: [
    CertificatesService,
    CertificateTemplatesService,
    CertificatePdfService,
    CertificateShareService,
  ],
})
export class CertificatesModule {}
