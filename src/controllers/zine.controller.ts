import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
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
  async zineCinemas(
    @Res({ passthrough: true }) res: Response,
    @Query('location') location: string,
  ) {
    return this.zineService.getCinemas(res, location);
  }

  @Get('cinema/:id')
  @ApiOperation({ summary: 'Get cinema and movies by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return cinema and movies by ID',
    type: CinemaDetails,
  })
  async zineCinema(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    return this.zineService.getCinema(res, id);
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
  async zineCinemaBasic(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    return this.zineService.getCinemaBasic(res, id);
  }

  @Get('movies')
  @ApiOperation({ summary: 'Get movies' })
  @ApiResponse({
    status: 200,
    description: 'Return movies',
    type: [Movie],
  })
  async zineMovies(@Res({ passthrough: true }) res: Response) {
    return this.zineService.getMovies(res);
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
  async zineCached(@Res({ passthrough: true }) res: Response) {
    return this.zineService.cached(res);
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
  async zineUpdateAll(@Res({ passthrough: true }) res: Response) {
    return this.zineService.updateAll(res);
  }
}
