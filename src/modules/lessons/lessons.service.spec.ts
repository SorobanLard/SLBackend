import { Test, TestingModule } from '@nestjs/testing';
import { LessonsService } from './lessons.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

describe('LessonsService', () => {
  let service: LessonsService;
  let prisma: any;

  const mockPrisma = {
    course: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    courseModule: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    lesson: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    lessonProgress: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LessonsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LessonsService>(LessonsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('createModule', () => {
    const courseId = 'course-1';
    const title = 'Introduction to React';
    const position = 1;
    const user = { id: 'user-1', stellarAddress: 'GABC', role: UserRole.INSTRUCTOR };

    it('should create a module for authorized instructor', async () => {
      const mockCourse = {
        id: courseId,
        instructorAddress: 'GABC',
        instructor: { id: 'user-1' },
      };

      const mockModule = {
        id: 'module-1',
        courseId,
        title,
        position,
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);
      mockPrisma.courseModule.create.mockResolvedValue(mockModule);

      const result = await service.createModule(courseId, title, position, user);

      expect(result).toEqual(mockModule);
      expect(mockPrisma.courseModule.create).toHaveBeenCalledWith({
        data: { courseId, title, position },
      });
    });

    it('should throw NotFoundException if course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(service.createModule(courseId, title, position, user))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not the course owner', async () => {
      const mockCourse = {
        id: courseId,
        instructorAddress: 'GXYZ',
        instructor: { id: 'other-user' },
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);

      await expect(service.createModule(courseId, title, position, user))
        .rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to create module regardless of ownership', async () => {
      const adminUser = { id: 'admin-1', stellarAddress: 'GADMIN', role: UserRole.ADMIN };
      const mockCourse = {
        id: courseId,
        instructorAddress: 'GXYZ',
        instructor: { id: 'other-user' },
      };

      const mockModule = {
        id: 'module-1',
        courseId,
        title,
        position,
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);
      mockPrisma.courseModule.create.mockResolvedValue(mockModule);

      const result = await service.createModule(courseId, title, position, adminUser);

      expect(result).toEqual(mockModule);
    });
  });

  describe('createLesson', () => {
    const moduleId = 'module-1';
    const lessonData = {
      title: 'Introduction to Hooks',
      description: 'Learn about React Hooks',
      type: 'VIDEO',
      videoUrl: 'https://cdn.example.com/video.mp4',
      videoDuration: 600,
      position: 1,
      isFree: false,
    };
    const user = { id: 'user-1', stellarAddress: 'GABC', role: UserRole.INSTRUCTOR };

    it('should create a lesson and increment course totalLessons', async () => {
      const mockModule = {
        id: moduleId,
        courseId: 'course-1',
        course: {
          id: 'course-1',
          instructorAddress: 'GABC',
          instructor: { id: 'user-1' },
        },
      };

      const mockLesson = {
        id: 'lesson-1',
        moduleId,
        ...lessonData,
      };

      mockPrisma.courseModule.findUnique.mockResolvedValue(mockModule);
      mockPrisma.lesson.create.mockResolvedValue(mockLesson);
      mockPrisma.course.update.mockResolvedValue({});

      const result = await service.createLesson(moduleId, lessonData, user);

      expect(result).toEqual(mockLesson);
      expect(mockPrisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { totalLessons: { increment: 1 } },
      });
    });

    it('should throw NotFoundException if module does not exist', async () => {
      mockPrisma.courseModule.findUnique.mockResolvedValue(null);

      await expect(service.createLesson(moduleId, lessonData, user))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not authorized', async () => {
      const mockModule = {
        id: moduleId,
        courseId: 'course-1',
        course: {
          id: 'course-1',
          instructorAddress: 'GXYZ',
          instructor: { id: 'other-user' },
        },
      };

      mockPrisma.courseModule.findUnique.mockResolvedValue(mockModule);

      await expect(service.createLesson(moduleId, lessonData, user))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('findLesson', () => {
    it('should return lesson with module and course details', async () => {
      const mockLesson = {
        id: 'lesson-1',
        title: 'Introduction',
        module: {
          id: 'module-1',
          course: { id: 'course-1' },
        },
        assignment: null,
      };

      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);

      const result = await service.findLesson('lesson-1');

      expect(result).toEqual(mockLesson);
    });

    it('should throw NotFoundException if lesson does not exist', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(null);

      await expect(service.findLesson('lesson-1'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('updateThumbnailUrl', () => {
    it('should update lesson thumbnail URL', async () => {
      const mockLesson = { id: 'lesson-1', title: 'Video Lesson' };
      const updatedLesson = { ...mockLesson, thumbnailUrl: 'https://cdn.example.com/thumb.jpg' };

      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.lesson.update.mockResolvedValue(updatedLesson);

      const result = await service.updateThumbnailUrl('lesson-1', 'https://cdn.example.com/thumb.jpg');

      expect(result.thumbnailUrl).toBe('https://cdn.example.com/thumb.jpg');
      expect(mockPrisma.lesson.update).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
        data: { thumbnailUrl: 'https://cdn.example.com/thumb.jpg' },
      });
    });

    it('should throw NotFoundException if lesson does not exist', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(null);

      await expect(service.updateThumbnailUrl('lesson-1', 'https://cdn.example.com/thumb.jpg'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('markLessonComplete', () => {
    const studentId = 'student-1';
    const enrollmentId = 'enrollment-1';
    const lessonId = 'lesson-1';

    it('should mark lesson as complete and recalculate progress', async () => {
      const mockEnrollment = {
        id: enrollmentId,
        studentId,
        course: {
          modules: [
            {
              lessons: [{ id: lessonId }],
            },
          ],
        },
      };

      const mockProgress = {
        enrollmentId,
        lessonId,
        completed: true,
        watchedSecs: 300,
        completedAt: expect.any(Date),
      };

      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);
      mockPrisma.lessonProgress.upsert.mockResolvedValue(mockProgress);
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce(mockEnrollment);
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({
        ...mockEnrollment,
        course: {
          modules: [{ lessons: [{ id: lessonId }] }],
        },
      });
      mockPrisma.lessonProgress.count.mockResolvedValue(1);
      mockPrisma.enrollment.update.mockResolvedValue({});

      const result = await service.markLessonComplete(studentId, enrollmentId, lessonId, 300);

      expect(result.completed).toBe(true);
      expect(mockPrisma.lessonProgress.upsert).toHaveBeenCalled();
    });

    it('should throw NotFoundException if enrollment does not exist', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.markLessonComplete(studentId, enrollmentId, lessonId))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if enrollment belongs to different student', async () => {
      const mockEnrollment = {
        id: enrollmentId,
        studentId: 'other-student',
        course: { modules: [] },
      };

      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);

      await expect(service.markLessonComplete(studentId, enrollmentId, lessonId))
        .rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if lesson is not part of enrolled course', async () => {
      const mockEnrollment = {
        id: enrollmentId,
        studentId,
        course: {
          modules: [
            {
              lessons: [{ id: 'other-lesson' }],
            },
          ],
        },
      };

      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);

      await expect(service.markLessonComplete(studentId, enrollmentId, lessonId))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('updateWatchProgress', () => {
    const studentId = 'student-1';
    const enrollmentId = 'enrollment-1';
    const lessonId = 'lesson-1';

    it('should update watch progress without marking as complete', async () => {
      const mockEnrollment = {
        id: enrollmentId,
        studentId,
        course: {
          modules: [
            {
              lessons: [{ id: lessonId }],
            },
          ],
        },
      };

      const mockProgress = {
        enrollmentId,
        lessonId,
        watchedSecs: 150,
      };

      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);
      mockPrisma.lessonProgress.upsert.mockResolvedValue(mockProgress);

      const result = await service.updateWatchProgress(studentId, enrollmentId, lessonId, 150);

      expect(result.watchedSecs).toBe(150);
    });
  });

  describe('getStudentProgress', () => {
    it('should return all lesson progress for an enrollment', async () => {
      const mockProgress = [
        {
          enrollmentId: 'enrollment-1',
          lessonId: 'lesson-1',
          completed: true,
          lesson: { title: 'Lesson 1', position: 1 },
        },
        {
          enrollmentId: 'enrollment-1',
          lessonId: 'lesson-2',
          completed: false,
          lesson: { title: 'Lesson 2', position: 2 },
        },
      ];

      mockPrisma.lessonProgress.findMany.mockResolvedValue(mockProgress);

      const result = await service.getStudentProgress('enrollment-1');

      expect(result).toHaveLength(2);
      expect(result[0].lesson.title).toBe('Lesson 1');
    });
  });
});
