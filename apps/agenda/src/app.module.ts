import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { requireEnv } from '@canopus/shared';
import { LoggingModule } from '@canopus/nest';
import { AdminService } from './admin.service';
import { AgendaController } from './agenda.controller';
import { EditorialStore } from './editorial/store';
import { CitySource } from './city/city.source';
import { Editorial } from './pipeline/editorial';
import { Identities } from './pipeline/identities';
import { Importer } from './pipeline/importer';
import { Publisher } from './pipeline/publisher';
import { Watchdog } from './pipeline/watchdog';
import { ReadService } from './read/read.service';
import { ALL_SCHEMAS } from './schemas/schemas';

/**
 * The agenda: what is on in Zaragoza, its big dates and its places.
 *
 * docs/agenda/ is the specification. This service holds the city's agenda as
 * an archive it never prunes, the series and editions written for it, and the
 * read side of the API the gateway serves under /agenda/v1.
 */
@Module({
  imports: [
    LoggingModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => requireEnv(config, ['MONGODB_URI']),
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI, { dbName: 'agenda' }),
    MongooseModule.forFeature(ALL_SCHEMAS),
    ScheduleModule.forRoot(),
    HttpModule,
  ],
  controllers: [AgendaController],
  providers: [
    CitySource,
    Identities,
    Publisher,
    Editorial,
    Importer,
    ReadService,
    EditorialStore,
    Watchdog,
    AdminService,
  ],
})
export class AppModule {}
