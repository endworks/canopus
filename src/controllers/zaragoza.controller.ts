import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZaragozaService } from '../services/zaragoza.service';

@Controller()
@ApiTags('zaragoza')
export class ZaragozaController {
  constructor(private readonly zaragozaService: ZaragozaService) {}

  @Get('zgz/bus/stations/:id')
  async zaragozaBusStation(@Param('id') id: string) {
    return this.zaragozaService.getBusStation(id);
  }

  @Get('zgz/tram/stations/:id')
  async zaragozaTramStation(@Param('id') id: string) {
    return this.zaragozaService.getTramStation(id);
  }
}
