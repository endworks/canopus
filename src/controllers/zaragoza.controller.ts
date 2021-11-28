import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZaragozaService } from '../services/zaragoza.service';

@Controller('zgz')
@ApiTags('zaragoza')
export class ZaragozaController {
  constructor(private readonly zaragozaService: ZaragozaService) {}

  @Get('bus/stations')
  async zaragozaBusStations() {
    return this.zaragozaService.getBusStations();
  }

  @Get('bus/stations/:id')
  async zaragozaBusStation(
    @Param('id') id: string,
    @Query('source') source: 'api' | 'web' | 'backup' = 'api',
  ) {
    return this.zaragozaService.getBusStation(id, source);
  }

  @Get('bus/lines')
  async zaragozaBusLines() {
    return this.zaragozaService.getBusLines();
  }

  @Get('bus/lines/:id')
  async zaragozaBusLine(@Param('id') id: string) {
    return this.zaragozaService.getBusLine(id);
  }

  @Get('tram/stations')
  async zaragozaTramStations() {
    return this.zaragozaService.getTramStations();
  }

  @Get('tram/stations/:id')
  async zaragozaTramStation(@Param('id') id: string) {
    return this.zaragozaService.getTramStation(id);
  }

  @Get('cinema')
  async zaragozaCinemas() {
    return this.zaragozaService.getCinemas();
  }

  @Get('cinema/:id')
  async zaragozaCinema(@Param('id') id: string) {
    return this.zaragozaService.getCinema(id);
  }

  @Get('cinema/:id/movies')
  async zaragozaCinemaMovies(@Param('id') id: string) {
    return this.zaragozaService.getCinemaMovies(id);
  }
}
