import { Test, TestingModule } from '@nestjs/testing';
import { ZineController } from './zine.controller';
import { ZineService } from '../services/zine.service';

/**
 * What the gateway's controllers are, and therefore what is worth testing.
 *
 * Every handler here takes a request apart and hands the pieces to a service
 * that puts them on the wire. There is no logic in between, so what can go
 * wrong is a handler calling the wrong method, or dropping the query parameter
 * on the way — a cinema listing that quietly ignores `?location=` and answers
 * for Zaragoza wherever it is asked from. That is what these assert.
 *
 * This file used to open a TCP client to `canopus-zine:8878` and assert the
 * reply was truthy. It never referenced the controller it is named after, it
 * passed only inside the compose network, and nowhere else did it fail loudly
 * enough to be noticed: the app's tsconfig left specs untypechecked, so it had
 * been failing to compile as well as to connect.
 */
describe('ZineController', () => {
  let controller: ZineController;
  let service: jest.Mocked<ZineService>;

  beforeEach(async () => {
    const zineService: Partial<jest.Mocked<ZineService>> = {
      getLocations: jest.fn().mockResolvedValue([{ id: 'zaragoza' }]),
      getCinemas: jest.fn().mockResolvedValue([{ id: '1' }]),
      getCinema: jest.fn().mockResolvedValue({ id: '1' }),
      getCinemaBasic: jest.fn().mockResolvedValue({ id: '1' }),
      getMovies: jest.fn().mockResolvedValue([{ id: 'm1' }]),
      cached: jest.fn().mockResolvedValue({}),
      prune: jest.fn().mockResolvedValue({}),
      updateAll: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ZineController],
      providers: [{ provide: ZineService, useValue: zineService }],
    }).compile();

    controller = module.get(ZineController);
    service = module.get(ZineService);
  });

  it('asks for the locations', async () => {
    await expect(controller.zineLocations()).resolves.toEqual([
      { id: 'zaragoza' },
    ]);
    expect(service.getLocations).toHaveBeenCalled();
  });

  it('passes the location through to the cinemas', async () => {
    await expect(controller.zineCinemas('valencia')).resolves.toEqual([
      { id: '1' },
    ]);
    expect(service.getCinemas).toHaveBeenCalledWith('valencia');
  });

  it('passes the location through to the movies', async () => {
    await controller.zineMovies('valencia');
    expect(service.getMovies).toHaveBeenCalledWith('valencia');
  });

  // Undefined rather than the string "undefined", which is what a missing
  // query parameter becomes if it is ever interpolated on the way past.
  it('leaves the location out when none was asked for', async () => {
    await controller.zineCinemas(undefined as unknown as string);
    expect(service.getCinemas).toHaveBeenCalledWith(undefined);
  });

  it('asks for one cinema by id', async () => {
    await controller.zineCinema('42');
    expect(service.getCinema).toHaveBeenCalledWith('42');
  });

  it('asks for the basic cinema by id', async () => {
    await controller.zineCinemaBasic('42');
    expect(service.getCinemaBasic).toHaveBeenCalledWith('42');
  });

  it('reports what is cached, prunes, and updates', async () => {
    await controller.zineCached();
    await controller.zinePrune();
    await controller.zineUpdateAll('zaragoza');

    expect(service.cached).toHaveBeenCalled();
    expect(service.prune).toHaveBeenCalled();
    expect(service.updateAll).toHaveBeenCalledWith('zaragoza');
  });
});
