import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Cinema, CinemaMovies } from '../models/zine.interface';
import { ZineService } from '../services/zine.service';

@Controller('zine')
@ApiTags('zine')
export class ZineController {
  constructor(private readonly zineService: ZineService) {}

  @Get('cinema')
  @ApiOperation({ summary: 'Get cinemas' })
  @ApiResponse({
    status: 200,
    description: 'Return cinemas',
    type: [Cinema],
  })
  async zineCinemas() {
    return this.zineService.getCinemas();
  }

  @Get('cinema/:id')
  @ApiOperation({ summary: 'Get cinema by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return cinema',
    type: Cinema,
  })
  async zineCinema(@Param('id') id: string) {
    return this.zineService.getCinema(id);
  }

  @Get('cinema/:id/movies')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get cinema and movies by ID' })
  @ApiResponse({
    status: 200,
    description: 'Return cinema and movies',
    type: CinemaMovies,
  })
  async zineCinemaMovies(@Param('id') id: string) {
    return this.zineService.getCinemaMovies(id);
  }
}
