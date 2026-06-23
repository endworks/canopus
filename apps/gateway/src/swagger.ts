import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Documents an endpoint that returns an id-keyed map (`{ [id]: model }`) rather
 * than an array — which is how the Zaragoza service returns its station/line
 * collections.
 */
export function ApiMapResponse(model: Type, description?: string) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description,
      schema: {
        type: 'object',
        additionalProperties: { $ref: getSchemaPath(model) },
      },
    }),
  );
}
