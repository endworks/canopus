import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiMapResponse } from '../swagger';
import { BiziStation, BusLine, Station } from '../models/zaragoza.interface';
import { ErrorResponse } from '../models/error.interface';
import { ZaragozaService } from '../services/zaragoza.service';

@ApiTags('Zaragoza')
@ApiDefaultResponse({ description: 'Error response', type: ErrorResponse })
@Controller('zgz')
export class ZaragozaController {
  constructor(private readonly zaragozaService: ZaragozaService) {}

  @Get('bus/stations')
  @ApiOperation({ summary: 'Get bus stations' })
  @ApiMapResponse(Station, 'Bus stations keyed by id')
  async zaragozaBusStations() {
    return this.zaragozaService.getBusStations();
  }

  @Get('bus/stations/:id')
  @ApiOperation({ summary: 'Get bus station by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'source', enum: ['api', 'web', 'backup'], required: false })
  @ApiResponse({
    status: 200,
    description: 'Return bus station',
    type: Station,
  })
  async zaragozaBusStation(
    @Param('id') id: string,
    @Query('source') source: 'api' | 'web' | 'backup',
  ) {
    return this.zaragozaService.getBusStation(id, source);
  }

  @Get('bus/lines')
  @ApiOperation({ summary: 'Get bus lines' })
  @ApiMapResponse(BusLine, 'Bus lines keyed by id')
  async zaragozaBusLines() {
    return this.zaragozaService.getBusLines();
  }

  @Get('bus/lines/update')
  @ApiOperation({ summary: 'Update bus line data' })
  @ApiMapResponse(BusLine, 'Updated bus lines keyed by id')
  async zaragozaBusLinesUpdate() {
    return this.zaragozaService.getBusLinesUpdate();
  }

  @Get('bus/lines/:id')
  @ApiOperation({ summary: 'Get bus line by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Return bus line', type: BusLine })
  async zaragozaBusLine(@Param('id') id: string) {
    return this.zaragozaService.getBusLine(id);
  }

  @Get('tram/stations')
  @ApiOperation({ summary: 'Get tram stations' })
  @ApiMapResponse(Station, 'Tram stations keyed by id')
  async zaragozaTramStations() {
    return this.zaragozaService.getTramStations();
  }

  @Get('tram/stations/:id')
  @ApiOperation({ summary: 'Get tram station by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'source', enum: ['api', 'web', 'backup'], required: false })
  @ApiResponse({
    status: 200,
    description: 'Return tram station',
    type: Station,
  })
  async zaragozaTramStation(
    @Param('id') id: string,
    @Query('source') source: 'api' | 'web' | 'backup',
  ) {
    return this.zaragozaService.getTramStation(id, source);
  }

  @Get('bizi/stations')
  @ApiOperation({ summary: 'Get bizi stations' })
  @ApiMapResponse(BiziStation, 'Bizi stations keyed by id')
  async zaragozaBiziStations() {
    return this.zaragozaService.getBiziStations();
  }

  @Get('bizi/stations/update')
  @ApiOperation({ summary: 'Update bizi stations data' })
  @ApiMapResponse(BiziStation, 'Updated bizi stations keyed by id')
  async zaragozaBiziStationsUpdate() {
    return this.zaragozaService.getBiziStationsUpdate();
  }

  @Get('bizi/stations/:id')
  @ApiOperation({ summary: 'Get bizi station by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return bizi station',
    type: BiziStation,
  })
  async zaragozaBiziStation(@Param('id') id: string) {
    return this.zaragozaService.getBiziStation(id);
  }
}
