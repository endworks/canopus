import { Controller, Get, Param } from '@nestjs/common';
import { ZaragozaService } from './zaragoza.service';

@Controller()
export class AppController {
  constructor(private readonly zaragozaService: ZaragozaService) {}

  @Get('zgz/bus/station/:id')
  async zaragozaBusStation(@Param('id') id: string) {
    return this.zaragozaService.getBusStation(id);
  }

  @Get('zgz/tram/station/:id')
  async zaragozaTramStation(@Param('id') id: string) {
    return this.zaragozaService.getTramStation(id);
  }
}
