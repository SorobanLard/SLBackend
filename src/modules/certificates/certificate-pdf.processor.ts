import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CERTIFICATE_PDF_QUEUE, CERTIFICATE_PDF_JOB } from '../../common/queue/queue.constants';
import { CertificatePdfService } from './certificate-pdf.service';

@Injectable()
@Processor(CERTIFICATE_PDF_QUEUE)
export class CertificatePdfProcessor extends WorkerHost {
  private readonly logger = new Logger(CertificatePdfProcessor.name);
  constructor(private readonly prisma: PrismaService, private readonly pdf: CertificatePdfService) {
    super();
  }

  async process(job: Job<{ certificateId: string }>) {
    if (job.name !== CERTIFICATE_PDF_JOB) throw new Error('UNKNOWN_CERTIFICATE_JOB');
    const cert = await this.prisma.certificate.findUnique({
      where: { id: job.data.certificateId },
      include: { student: true, course: true },
    });
    if (!cert) throw new Error('CERTIFICATE_NOT_FOUND');
    if (cert.pdfUrl) return { pdfUrl: cert.pdfUrl };

    const buffer = await this.pdf.renderForCategory(cert.course.category, {
      studentName: cert.student.name,
      courseTitle: cert.course.title,
      certificateId: cert.id,
      issuedAt: cert.issuedAt,
      category: cert.course.category,
    });
    // Worker instances must share this persistent volume in production.
    const dir = resolve(process.env.CERTIFICATE_PDF_DIR ?? './uploads/certificates');
    await mkdir(dir, { recursive: true });
    const destination = join(dir, cert.id + '.pdf');
    const temp = destination + '.' + job.id + '.tmp';
    try {
      await writeFile(temp, buffer, { flag: 'w' });
      await rename(temp, destination);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    const pdfUrl = 'certificates/' + cert.id + '.pdf';
    await this.prisma.certificate.update({ where: { id: cert.id }, data: { pdfUrl } });
    this.logger.log('Certificate PDF rendered: ' + cert.id);
    return { pdfUrl };
  }
}
