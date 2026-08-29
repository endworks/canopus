import { Controller, Get } from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from '../models/error.interface';
import { City } from '../models/cities.interface';
import { CitiesService } from '../services/cities.service';

@ApiTags('Cities')
@ApiDefaultResponse({ description: 'Error response', type: ErrorResponse })
@Controller('cities')
export class CitiesController {
  constructor(private readonly citiesService: CitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the cities this API serves, and what it serves for each',
  })
  @ApiResponse({
    status: 200,
    description: 'Return the supported cities',
    type: [City],
  })
  async cities() {
    return this.citiesService.getCities();
  }
}
