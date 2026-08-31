import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { ZARAGOZA_PATTERNS } from '@canopus/shared';
import { PlacePayload, PlacesPayload } from '../models/place.interface';
import { PlacesService } from '../services/places.service';

@Controller()
export class PlacesController {
  constructor(private readonly placesService: PlacesService) {}

  @MessagePattern(ZARAGOZA_PATTERNS.places, Transport.TCP)
  async places(@Payload() data: PlacesPayload) {
    return this.placesService.getPlaces(data.kind);
  }

  @MessagePattern(ZARAGOZA_PATTERNS.place, Transport.TCP)
  async place(@Payload() data: PlacePayload) {
    return this.placesService.getPlace(data.kind, data.id);
  }

  @MessagePattern(ZARAGOZA_PATTERNS.taxis, Transport.TCP)
  async taxis() {
    return this.placesService.getLiveTaxis();
  }
}
