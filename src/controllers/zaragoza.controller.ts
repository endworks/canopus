import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZaragozaService } from '../services/zaragoza.service';

@Controller()
@ApiTags('zaragoza')
export class ZaragozaController {
  constructor(private readonly zaragozaService: ZaragozaService) {}

  @Get('zgz/bus/stations')
  async zaragozaBusStations() {
    return this.zaragozaService.getBusStations();
  }

  @Get('zgz/bus/stations/:id')
  async zaragozaBusStation(
    @Param('id') id: string,
    @Query('source') source: 'official-api' | 'web' = 'official-api',
  ) {
    return this.zaragozaService.getBusStation(id, source);
  }

  @Get('zgz/bus/lines')
  async zaragozaBusLines() {
    return this.zaragozaService.getBusLines();
  }

  @Get('zgz/bus/lines/:id')
  async zaragozaBusLine(@Param('id') id: string) {
    return this.zaragozaService.getBusLine(id);
  }

  @Get('zgz/tram/stations')
  async zaragozaTramStations() {
    return this.zaragozaService.getTramStations();
  }

  @Get('zgz/tram/stations/:id')
  async zaragozaTramStation(@Param('id') id: string) {
    return this.zaragozaService.getTramStation(id);
  }
}
