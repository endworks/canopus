import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Line, Station } from '../models/zaragoza.interface';
import { ZaragozaService } from '../services/zaragoza.service';

@ApiTags('Zaragoza')
@Controller('zgz')
export class ZaragozaController {
  constructor(private readonly zaragozaService: ZaragozaService) {}

  @Get('bus/stations')
  @ApiOperation({ summary: 'Get bus stations' })
  @ApiResponse({
    status: 200,
    description: 'Return bus stations',
    type: [Station],
  })
  async zaragozaBusStations(@Res({ passthrough: true }) res: Response) {
    return this.zaragozaService.getBusStations(res);
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
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Query('source') source: 'api' | 'web' | 'backup',
  ) {
    return this.zaragozaService.getBusStation(res, id, source);
  }

  @Get('bus/lines')
  @ApiOperation({ summary: 'Get bus lines' })
  @ApiResponse({
    status: 200,
    description: 'Return bus lines',
    type: [Line],
  })
  async zaragozaBusLines(@Res({ passthrough: true }) res: Response) {
    return this.zaragozaService.getBusLines(res);
  }

  @Get('bus/lines/update')
  @ApiOperation({ summary: 'Update bus line data' })
  @ApiResponse({
    status: 200,
    description: 'Return updated bus lines',
    type: [Line],
  })
  async zaragozaBusLinesUpdate(@Res({ passthrough: true }) res: Response) {
    return this.zaragozaService.getBusLinesUpdate(res);
  }

  @Get('bus/lines/:id')
  @ApiOperation({ summary: 'Get bus line by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return bus line',
    type: Line,
  })
  async zaragozaBusLine(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    return this.zaragozaService.getBusLine(res, id);
  }

  @Get('tram/stations')
  @ApiOperation({ summary: 'Get tram stations' })
  @ApiResponse({
    status: 200,
    description: 'Return tram stations',
    type: [Station],
  })
  async zaragozaTramStations(@Res({ passthrough: true }) res: Response) {
    return this.zaragozaService.getTramStations(res);
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
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Query('source') source: 'api' | 'web' | 'backup',
  ) {
    return this.zaragozaService.getTramStation(res, id, source);
  }
}
