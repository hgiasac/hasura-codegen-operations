import {
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
} from "graphql";
import { camel, snake } from "radash";

export type ModelFieldSchema = {
  name: string;
  type: string;
  array: boolean;
  nullable: boolean;
  isEnum: boolean;
};

export type ModelSchemas = {
  primaryKeys: ModelFieldSchema[];
  permissions: {
    get: boolean;
    insert: boolean;
    update: boolean;
    delete: boolean;
  };
  model: ModelFieldSchema[];
  insertInput: ModelFieldSchema[];
  setInput: ModelFieldSchema[];
};

type BuildModelSchemaOptions = {
  disableFields: string[] | undefined;
  disableFieldPrefixes: string[] | undefined;
  disableFieldSuffixes: string[] | undefined;
  primaryKeyNames: string[] | undefined;
  headFields: string[];
  tailFields: string[];
};

const buildModelSchemas = (
  schema: GraphQLSchema,
  models: string[],
  options: BuildModelSchemaOptions
): Record<string, ModelSchemas> => {
  const mutationFields = schema.getMutationType()?.getFields();

  return models.reduce((acc, modelName) => {
    const fieldName = snake(modelName);
    const fieldInsertInputName = snake(`${fieldName}_insert_input`);
    const fieldSetInputName = snake(`${fieldName}_set_input`);
    const deleteFieldName = `delete_${fieldName}`;
    const fieldPkColumnsName = snake(`${fieldName}_pk_columns_input`);

    const fieldNameCamelCase = camel(modelName);
    const fieldInsertInputNameCamelCase = camel(fieldInsertInputName);
    const fieldSetInputNameCamelCase = camel(fieldSetInputName);
    const deleteFieldNameCamelCase = camel(deleteFieldName);
    const fieldPkColumnsNameCamelCase = camel(fieldPkColumnsName);

    const modelType = (
      isObjectType(schema.getType(fieldName))
        ? schema.getType(fieldName)
        : schema.getType(fieldNameCamelCase)
    ) as GraphQLObjectType;

    const insertInputType = (
      isInputObjectType(schema.getType(fieldInsertInputName))
        ? schema.getType(fieldInsertInputName)
        : schema.getType(fieldInsertInputNameCamelCase)
    ) as GraphQLInputObjectType;

    const setInputType = (
      isInputObjectType(schema.getType(fieldSetInputName))
        ? schema.getType(fieldSetInputName)
        : schema.getType(fieldSetInputNameCamelCase)
    ) as GraphQLInputObjectType;

    const pkInputType = (
      isInputObjectType(schema.getType(fieldPkColumnsName))
        ? schema.getType(fieldPkColumnsName)
        : schema.getType(fieldPkColumnsNameCamelCase)
    ) as GraphQLInputObjectType;

    const canDelete = Boolean(
      Boolean(mutationFields) && (Boolean(mutationFields![deleteFieldName]) || Boolean(mutationFields![deleteFieldNameCamelCase]))  
    );

    const modelSchemas = isObjectType(modelType)
      ? buildModelSchema(modelType, options)
      : [];

    const insertInput = isInputObjectType(insertInputType)
      ? buildModelSchema(insertInputType, options)
      : [];

    const setInput = isInputObjectType(setInputType)
      ? buildModelSchema(setInputType, options)
      : [];

    const primaryKeys = isInputObjectType(pkInputType)
      ? buildModelSchema(pkInputType, options)
      : modelSchemas.filter((m) => options.primaryKeyNames?.includes(m.name));

    const result: ModelSchemas = {
      primaryKeys,
      model: sortFieldOrder(modelSchemas, options.headFields, options.tailFields),
      insertInput: sortFieldOrder(insertInput, options.headFields, options.tailFields),
      setInput: sortFieldOrder(setInput, options.headFields, options.tailFields),
      permissions: {
        get: modelSchemas.length > 0,
        insert: insertInput.length > 0,
        update: setInput.length > 0,
        delete: canDelete,
      },
    };

    if (!result.model.length && !result.insertInput.length && !result.setInput.length) {
      throw new Error(
        `model ${modelName} doesn't exist, or maybe the role doesn't have any permission`
      );
    }

    return {
      ...acc,
      [modelName]: result,
    };
  }, {});
};

const getInnerSchemaType = (
  gqlType: GraphQLType,
  schema: ModelFieldSchema
): ModelFieldSchema | null => {
  if (isNonNullType(gqlType)) {
    return getInnerSchemaType(gqlType.ofType, {
      ...schema,
      nullable: false,
    });
  }
  if (isObjectType(gqlType) || isInputObjectType(gqlType)) {
    return null;
  }

  if (isListType(gqlType)) {
    return getInnerSchemaType(gqlType.ofType, {
      ...schema,
      array: true,
    });
  }

  if (isEnumType(gqlType)) {
    return {
      ...schema,
      type: gqlType.name,
      isEnum: true,
    };
  }

  return {
    ...schema,
    type: gqlType.name,
  };
};

const buildModelSchema = (
  modelType: GraphQLObjectType | GraphQLInputObjectType,
  options: BuildModelSchemaOptions
): ModelFieldSchema[] => {
  const fieldMap = modelType.getFields();
  return Object.keys(fieldMap).reduce((acc, key) => {
    if (
      Boolean(options.disableFields?.includes(key)) ||
      Boolean(options.disableFieldPrefixes?.some((disabledTerm) => key.startsWith(disabledTerm))) ||
      Boolean(options.disableFieldSuffixes?.some((disabledTerm) => key.endsWith(disabledTerm))) 
    ) {
      return acc;
    }

    const field = fieldMap[key];
    const schema = getInnerSchemaType(field.type, {
      name: key,
      type: "",
      array: false,
      nullable: true,
      isEnum: false,
    });

    if (!schema) {
      return acc;
    }

    return [...acc, schema];
  }, []);
};

const pickField = ([hs, remain]: [ModelFieldSchema[], ModelFieldSchema[]], name: string) => {
  const field = remain.find((f) => f.name === name);
  return !field ? [hs, remain] : [[
    ...hs,
    field
  ], remain.filter((f) => f.name !== name)]
}

const sortFieldOrder = (fields: ModelFieldSchema[], headFields: string[], tailFields: string[]): ModelFieldSchema[] => {

  const [head, excludeHead] = headFields.reduce(pickField, [[], fields]);  
  const [tail, remain] = tailFields.reduce(pickField, [[], excludeHead]);  

  return [
    ...head,
    ...remain,
    ...tail
  ]
}

export default buildModelSchemas;
