import { Test, TestingModule } from '@nestjs/testing';
import { ClientProxy, ClientsModule, Transport } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { INestApplication } from '@nestjs/common';

describe('ZineController', () => {
  let app: INestApplication;
  let client: ClientProxy;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ClientsModule.register([
          {
            name: 'ZINE_SERVICE',
            transport: Transport.TCP,
            options: {
              host: 'canopus-zine',
              port: 8878,
            },
          },
        ]),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.connectMicroservice({
      transport: Transport.TCP,
    });

    await app.startAllMicroservices();
    await app.init();

    client = app.get('ZINE_SERVICE');
    await client.connect();
  });

  afterAll(async () => {
    await app.close();
    client.close();
  });

  it('Get cinemas', (done) => {
    const response: Observable<any> = client.send('cinemas', {});

    response.subscribe((json) => {
      expect(json).toBeTruthy();
      done();
    });
  });
});
