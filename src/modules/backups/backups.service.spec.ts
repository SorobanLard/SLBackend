import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  CourseBackupStatus,
  CourseStatus,
  LessonType,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { BackupsService } from "./backups.service";

describe("BackupsService", () => {
  let service: BackupsService;

  const mockPrisma = {
    course: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    courseBackup: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  const sampleCourse = {
    id: "course-123",
    title: "Sewing Basics",
    description: "Learn foundational sewing techniques",
    category: "Tailoring",
    level: "Beginner",
    language: "English",
    thumbnailUrl: "https://example.com/thumb.jpg",
    previewVideoUrl: "https://example.com/preview.mp4",
    price: 49.99,
    platformFeePercent: 20,
    status: CourseStatus.ACTIVE,
    instructorAddress: "GBB4NR2",
    modules: [
      {
        id: "mod-1",
        title: "Introduction",
        position: 0,
        lessons: [
          {
            id: "les-1",
            title: "Welcome",
            description: "Course introduction",
            type: LessonType.VIDEO,
            videoUrl: "https://example.com/video1.mp4",
            videoDuration: 300,
            content: null,
            resourceUrl: null,
            position: 0,
            isFree: true,
          },
          {
            id: "les-2",
            title: "Tool guide",
            description: "Required sewing kit",
            type: LessonType.TEXT,
            videoUrl: null,
            videoDuration: null,
            content: "Here is what you need...",
            resourceUrl: "https://example.com/sheet.pdf",
            position: 1,
            isFree: false,
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BackupsService>(BackupsService);
    jest.clearAllMocks();
  });

  describe("exportCourseBackup", () => {
    it("should export full course structure and create version 1 when no previous backup exists", async () => {
      mockPrisma.course.findUnique.mockResolvedValue(sampleCourse);
      mockPrisma.courseBackup.findFirst.mockResolvedValue(null);
      mockPrisma.courseBackup.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: "backup-1", ...data }),
      );

      const user = {
        id: "u-1",
        role: UserRole.INSTRUCTOR,
        stellarAddress: "GBB4NR2",
      };

      const result = await service.exportCourseBackup("course-123", user);

      expect(mockPrisma.course.findUnique).toHaveBeenCalledWith({
        where: { id: "course-123" },
        include: {
          modules: {
            orderBy: { position: "asc" },
            include: {
              lessons: {
                orderBy: { position: "asc" },
              },
            },
          },
        },
      });

      expect(mockPrisma.courseBackup.findFirst).toHaveBeenCalledWith({
        where: { courseId: "course-123" },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      expect(mockPrisma.courseBackup.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseId: "course-123",
          version: 1,
          status: CourseBackupStatus.COMPLETED,
          isAutomatic: false,
          requestedBy: "u-1",
          isComplete: true,
        }),
      });

      expect(result.version).toBe(1);
      expect(result.status).toBe(CourseBackupStatus.COMPLETED);
    });

    it("should increment version when a previous backup exists for the course", async () => {
      mockPrisma.course.findUnique.mockResolvedValue(sampleCourse);
      mockPrisma.courseBackup.findFirst.mockResolvedValue({ version: 3 });
      mockPrisma.courseBackup.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: "backup-4", ...data }),
      );

      const adminUser = { id: "admin-1", role: UserRole.ADMIN };
      const result = await service.exportCourseBackup("course-123", adminUser);

      expect(result.version).toBe(4);
      expect(mockPrisma.courseBackup.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          version: 4,
          requestedBy: "admin-1",
        }),
      });
    });

    it("should throw NotFoundException if course does not exist", async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(
        service.exportCourseBackup("non-existent", {
          id: "u-1",
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if instructor does not own the course", async () => {
      mockPrisma.course.findUnique.mockResolvedValue(sampleCourse);

      const unauthorizedInstructor = {
        id: "u-2",
        role: UserRole.INSTRUCTOR,
        stellarAddress: "GDIFFERENTADDRESS",
      };

      await expect(
        service.exportCourseBackup("course-123", unauthorizedInstructor),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("validateCompleteness", () => {
    it("should mark complete when course, modules, and lessons are valid", () => {
      const report = service.validateCompleteness(sampleCourse);

      expect(report.isComplete).toBe(true);
      expect(report.errors).toHaveLength(0);
      expect(report.totalModules).toBe(1);
      expect(report.totalLessons).toBe(2);
      expect(report.totalVideoLessons).toBe(1);
      expect(report.totalTextLessons).toBe(1);
      expect(report.missingVideoLessons).toHaveLength(0);
      expect(report.missingContentLessons).toHaveLength(0);
    });

    it("should flag errors when video lesson lacks videoUrl or text lesson lacks content", () => {
      const incompleteCourse = {
        ...sampleCourse,
        modules: [
          {
            id: "mod-1",
            title: "Basics",
            position: 0,
            lessons: [
              {
                id: "l-v",
                title: "Missing Video",
                position: 0,
                type: LessonType.VIDEO,
                videoUrl: "",
              },
              {
                id: "l-t",
                title: "Missing Text",
                position: 1,
                type: LessonType.TEXT,
                content: "",
              },
            ],
          },
        ],
      };

      const report = service.validateCompleteness(incompleteCourse);

      expect(report.isComplete).toBe(false);
      expect(report.missingVideoLessons).toHaveLength(1);
      expect(report.missingContentLessons).toHaveLength(1);
      expect(report.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("has no video URL"),
          expect.stringContaining("has no textual content"),
        ]),
      );
    });

    it("should flag error if course has zero modules", () => {
      const noModuleCourse = {
        ...sampleCourse,
        modules: [],
      };

      const report = service.validateCompleteness(noModuleCourse);
      expect(report.isComplete).toBe(false);
      expect(report.errors).toContain("Course contains no modules");
    });

    it("should add warnings for duplicate positions or empty modules", () => {
      const duplicatePosCourse = {
        ...sampleCourse,
        modules: [
          {
            id: "m1",
            title: "Module 1",
            position: 0,
            lessons: [],
          },
          {
            id: "m2",
            title: "Module 2",
            position: 0,
            lessons: [],
          },
        ],
      };

      const report = service.validateCompleteness(duplicatePosCourse);

      expect(report.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("duplicate position"),
          expect.stringContaining("has no lessons"),
        ]),
      );
    });
  });

  describe("getBackupById", () => {
    it("should return the backup when found", async () => {
      const backup = { id: "backup-1", courseId: "course-123" };
      mockPrisma.courseBackup.findUnique.mockResolvedValue(backup);

      const result = await service.getBackupById("backup-1");

      expect(mockPrisma.courseBackup.findUnique).toHaveBeenCalledWith({
        where: { id: "backup-1" },
      });
      expect(result).toEqual(backup);
    });

    it("should throw NotFoundException when backup is missing", async () => {
      mockPrisma.courseBackup.findUnique.mockResolvedValue(null);

      await expect(service.getBackupById("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("listCourseBackups", () => {
    it("should return backups for a course ordered by version", async () => {
      const backups = [{ id: "b1", version: 2 }, { id: "b2", version: 1 }];
      mockPrisma.courseBackup.findMany.mockResolvedValue(backups);

      const result = await service.listCourseBackups("course-123");

      expect(mockPrisma.courseBackup.findMany).toHaveBeenCalledWith({
        where: { courseId: "course-123" },
        orderBy: { version: "desc" },
      });
      expect(result).toEqual(backups);
    });
  });

  describe("restoreCourseBackup", () => {
    it("should throw NotFoundException when backup does not exist", async () => {
      mockPrisma.courseBackup.findUnique.mockResolvedValue(null);

      await expect(
        service.restoreCourseBackup("missing", { id: "u-1", role: UserRole.ADMIN }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when backup is not completed", async () => {
      mockPrisma.courseBackup.findUnique.mockResolvedValue({
        id: "backup-1",
        courseId: "course-123",
        status: CourseBackupStatus.FAILED,
        data: {},
      });

      await expect(
        service.restoreCourseBackup("backup-1", { id: "u-1", role: UserRole.ADMIN }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
