import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { cacheTTL } from '../utils';
import { PlacesController } from '../controllers/places.controller';
import { PlacesService } from '../services/places.service';

/**
 * No Mongoose. The bus and the Bizi keep a collection because they hold what
 * the city does not — times gathered per stop, docks counted per station, and
 * a fallback for when the city's own service is down mid-journey. These are
 * lists of points that change on the city's schedule, not ours, so the cache
 * is the whole of the storage.
 */
@Module({
  imports: [HttpModule, CacheModule.register({ ttl: cacheTTL })],
  controllers: [PlacesController],
  providers: [PlacesService],
  exports: [PlacesService],
})
export class PlacesModule {}
