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
  disableFields?: string[];
  primaryKeyNames?: string[];
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
      model: modelSchemas,
      insertInput,
      setInput,
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
      options.disableFields?.some((disabledTerm) => key.includes(disabledTerm))
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

export default buildModelSchemas;
