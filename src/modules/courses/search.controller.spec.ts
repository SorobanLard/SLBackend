import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { CourseSearchController } from './search.controller';
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('CourseSearchController', () => {
    let controller: CourseSearchController;
    let coursesService: {
        searchCourses: jest.Mock;
        getSearchSuggestions: jest.Mock;
    };

    beforeEach(async () => {
        coursesService = {
            searchCourses: jest.fn(),
            getSearchSuggestions: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [CourseSearchController],
            providers: [
                { provide: CoursesService, useValue: coursesService },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<CourseSearchController>(CourseSearchController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('search', () => {
        it('delegates to coursesService.searchCourses with the query', async () => {
            const query = { q: 'nestjs', page: 1, limit: 10 } as any;
            const expected = { data: [], total: 0 };
            coursesService.searchCourses.mockResolvedValue(expected);

            const result = await controller.search(query);

            expect(coursesService.searchCourses).toHaveBeenCalledWith(query);
            expect(result).toBe(expected);
        });
    });

    describe('suggestions', () => {
        it('delegates to coursesService.getSearchSuggestions with the query', async () => {
            const query = { q: 'nest' } as any;
            const expected = ['nestjs', 'nest'];
            coursesService.getSearchSuggestions.mockResolvedValue(expected);

            const result = await controller.getSuggestions(query);

            expect(coursesService.getSearchSuggestions).toHaveBeenCalledWith(query);
            expect(result).toBe(expected);
        });
    });

    describe('guard and role wiring', () => {
        const reflector = new Reflector();

        it('applies JwtAuthGuard and RolesGuard to the controller', () => {
            const guards = Reflect.getMetadata('__guards__', CourseSearchController) || [];
            expect(guards).toEqual(
                expect.arrayContaining([JwtAuthGuard, RolesGuard]),
            );
        });

        it('declares required roles metadata on the controller', () => {
            const roles = reflector.get(ROLES_KEY, CourseSearchController);
            expect(roles).toBeDefined();
        });
    });
});
