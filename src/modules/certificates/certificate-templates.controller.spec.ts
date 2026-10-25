import { Test, TestingModule } from '@nestjs/testing';
import { StreamableFile } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { CertificateTemplatesController } from './certificate-templates.controller';
import { CertificateTemplatesService } from './certificate-templates.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';
import { validateFileMimeType } from './mime-validator';

jest.mock('./mime-validator', () => ({ validateFileMimeType: jest.fn() }));

describe('CertificateTemplatesController', () => {
  let controller: CertificateTemplatesController;

  const mockTemplatesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    getActiveTemplateForCategory: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    preview: jest.fn(),
    activate: jest.fn(),
    deactivate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertificateTemplatesController],
      providers: [{ provide: CertificateTemplatesService, useValue: mockTemplatesService }],
    }).compile();

    controller = module.get<CertificateTemplatesController>(CertificateTemplatesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('create delegates with admin id and dto', async () => {
    const dto = { name: 'T' } as any;
    mockTemplatesService.create.mockResolvedValue({ id: 't-1' });

    const res = await controller.create('admin-1', dto);

    expect(mockTemplatesService.create).toHaveBeenCalledWith('admin-1', dto);
    expect(res).toEqual({ id: 't-1' });
  });

  it('findAll delegates with query', async () => {
    const query = { category: 'Tailoring' } as any;
    mockTemplatesService.findAll.mockResolvedValue([]);

    await controller.findAll(query);

    expect(mockTemplatesService.findAll).toHaveBeenCalledWith(query);
  });

  it('getActive delegates to getActiveTemplateForCategory', async () => {
    await controller.getActive('Tailoring');
    expect(mockTemplatesService.getActiveTemplateForCategory).toHaveBeenCalledWith('Tailoring');
  });

  it.each([
    ['findOne', 'findOne'],
    ['remove', 'remove'],
    ['activate', 'activate'],
    ['deactivate', 'deactivate'],
  ] as const)('%s delegates with id', async (method, serviceMethod) => {
    mockTemplatesService[serviceMethod].mockResolvedValue({ id: 't-1' });

    const res = await controller[method]('t-1');

    expect(mockTemplatesService[serviceMethod]).toHaveBeenCalledWith('t-1');
    expect(res).toEqual({ id: 't-1' });
  });

  it('update delegates with id and dto', async () => {
    const dto = { name: 'New' } as any;
    await controller.update('t-1', dto);
    expect(mockTemplatesService.update).toHaveBeenCalledWith('t-1', dto);
  });

  it('preview returns the rendered PDF as a StreamableFile', async () => {
    const dto = {} as any;
    mockTemplatesService.preview.mockResolvedValue(Buffer.from('%PDF'));

    const res = await controller.preview('t-1', dto);

    expect(mockTemplatesService.preview).toHaveBeenCalledWith('t-1', dto);
    expect(res).toBeInstanceOf(StreamableFile);
    expect(res.getHeaders()).toMatchObject({
      type: 'application/pdf',
      disposition: 'inline; filename="certificate-preview.pdf"',
    });
  });

  it('uploadTemplateFile validates the MIME type and returns the filename', async () => {
    const file = { buffer: Buffer.from('x'), originalname: 'logo.png' } as Express.Multer.File;

    const res = await controller.uploadTemplateFile(file);

    expect(validateFileMimeType).toHaveBeenCalledWith(file.buffer, 'logo.png');
    expect(res).toEqual({ message: 'File validated successfully', filename: 'logo.png' });
  });

  it('is restricted to ADMIN via JwtAuthGuard + RolesGuard at the controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CertificateTemplatesController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, CertificateTemplatesController)).toEqual([UserRole.ADMIN]);
  });
});
