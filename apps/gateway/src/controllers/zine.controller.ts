import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CacheData,
  Cinema,
  CinemaDetails,
  CinemaDetailsBasic,
  Movie,
} from '../models/zine.interface';
import { ZineService } from '../services/zine.service';

@ApiTags('Zine, cinemas and movies')
@Controller('zine')
export class ZineController {
  constructor(private readonly zineService: ZineService) {}

  @Get('cinema')
  @ApiOperation({ summary: 'Get cinemas' })
  @ApiQuery({
    name: 'location',
    type: String,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Return cinemas',
    type: [Cinema],
  })
  async zineCinemas(@Query('location') location: string) {
    return this.zineService.getCinemas(location);
  }

  @Get('cinema/:id')
  @ApiOperation({ summary: 'Get cinema and movies by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return cinema and movies by ID',
    type: CinemaDetails,
  })
  async zineCinema(@Param('id') id: string) {
    return this.zineService.getCinema(id);
  }

  @Get('cinema/:id/basic')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'Get cinema and basic details about movies by ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Return cinema and basic details about movies by ID',
    type: CinemaDetailsBasic,
  })
  async zineCinemaBasic(@Param('id') id: string) {
    return this.zineService.getCinemaBasic(id);
  }

  @Get('movies')
  @ApiOperation({ summary: 'Get movies' })
  @ApiResponse({
    status: 200,
    description: 'Return movies',
    type: [Movie],
  })
  async zineMovies() {
    return this.zineService.getMovies();
  }

  @Get('cached')
  @ApiOperation({
    summary: 'Get cached data IDs',
  })
  @ApiResponse({
    status: 200,
    description: 'Return status code',
    type: CacheData,
  })
  async zineCached() {
    return this.zineService.cached();
  }

  @Get('updateAll')
  @ApiOperation({
    summary: 'Update all movies for all cinemas and caches them',
  })
  @ApiResponse({
    status: 200,
    description: 'Return status code',
    type: CacheData,
  })
  async zineUpdateAll() {
    return this.zineService.updateAll();
  }
}
