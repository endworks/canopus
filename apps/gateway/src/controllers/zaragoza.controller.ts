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
import {
  BiziStation,
  BusLine,
  Place,
  ServiceAlert,
  Station,
} from '../models/zaragoza.interface';
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

  @Get('bus/alerts')
  @ApiOperation({ summary: 'Get bus service alerts' })
  @ApiResponse({
    status: 200,
    description: 'Alterations in force, newest first',
    type: ServiceAlert,
    isArray: true,
  })
  async zaragozaBusAlerts() {
    return this.zaragozaService.getBusAlerts();
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

  /**
   * One route for every set of points the city publishes.
   *
   * A taxi rank, a chemist on duty and a bike rack are an id, a name and a
   * point apiece; giving each its own path would be the same handler written
   * eight times. `kind` picks the set, and adding the ninth is a line in a
   * table rather than a service, a module and a route.
   */
  @Get('places/:kind')
  @ApiOperation({ summary: 'Get places of one kind' })
  @ApiParam({
    name: 'kind',
    type: String,
    description: 'taxi-rank | taxi-office | pharmacy',
  })
  @ApiMapResponse(Place, 'Places keyed by id')
  async zaragozaPlaces(@Param('kind') kind: string) {
    return this.zaragozaService.getPlaces(kind);
  }

  @Get('places/:kind/:id')
  @ApiOperation({ summary: 'Get one place by kind and ID' })
  @ApiParam({ name: 'kind', type: String })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Return place', type: Place })
  async zaragozaPlace(@Param('kind') kind: string, @Param('id') id: string) {
    return this.zaragozaService.getPlace(kind, id);
  }

  /**
   * The taxis for hire, right now.
   *
   * Not a `kind` on the route above: that one answers with where things are
   * and is good for a day, this one answers with what is moving and is stale
   * in half a minute. One route each so a caller can cache them differently
   * without being told to.
   */
  @Get('taxis')
  @ApiOperation({ summary: 'Get taxis currently circulating' })
  @ApiMapResponse(Place, 'Live taxis keyed by id')
  async zaragozaTaxis() {
    return this.zaragozaService.getLiveTaxis();
  }
}
