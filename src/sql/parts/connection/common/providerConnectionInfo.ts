/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Disposable } from 'vs/base/common/lifecycle';
import { isString } from 'vs/base/common/types';

import * as sqlops from 'sqlops';
import * as interfaces from 'sql/parts/connection/common/interfaces';
import { ConnectionOptionSpecialType, ServiceOptionType } from 'sql/workbench/api/common/sqlExtHostTypes';
import * as Constants from 'sql/parts/connection/common/constants';
import { ICapabilitiesService } from 'sql/services/capabilities/capabilitiesService';
import { ConnectionProviderProperties } from 'sql/workbench/parts/connection/common/connectionProviderExtension';

export class ProviderConnectionInfo extends Disposable implements sqlops.ConnectionInfo {

	options: { [name: string]: any } = {};

	private _providerName: string;
	protected _serverCapabilities: ConnectionProviderProperties;
	private static readonly SqlAuthentication = 'SqlLogin';
	public static readonly ProviderPropertyName = 'providerName';

	public constructor(
		protected capabilitiesService: ICapabilitiesService,
		model: string | interfaces.IConnectionProfile
	) {
		super();
		// we can't really do a whole lot if we don't have a provider
		if (isString(model) || (model && model.providerName)) {
			this.providerName = isString(model) ? model : model.providerName;

			if (!isString(model)) {
				if (model.options && this._serverCapabilities) {
					this._serverCapabilities.connectionOptions.forEach(option => {
						let value = model.options[option.name];
						this.options[option.name] = value;
					});
				}
				this.serverName = model.serverName;
				this.authenticationType = model.authenticationType;
				this.databaseName = model.databaseName;
				this.password = model.password;
				this.userName = model.userName;
			}
		}
	}

	public get providerName(): string {
		return this._providerName;
	}

	public set providerName(name: string) {
		this._providerName = name;
		if (!this._serverCapabilities) {
			let capabilities = this.capabilitiesService.getCapabilities(this.providerName);
			if (capabilities) {
				this._serverCapabilities = capabilities.connection;
			}
			this._register(this.capabilitiesService.onCapabilitiesRegistered(e => {
				if (e.connection.providerId === this.providerName) {
					this._serverCapabilities = e.connection;
				}
			}));
		}
	}

	public clone(): ProviderConnectionInfo {
		let instance = new ProviderConnectionInfo(this.capabilitiesService, this.providerName);
		instance.options = Object.assign({}, this.options);
		return instance;
	}

	public get serverCapabilities(): ConnectionProviderProperties {
		return this._serverCapabilities;
	}

	public get serverName(): string {
		return this.getSpecialTypeOptionValue(ConnectionOptionSpecialType.serverName);
	}

	public get databaseName(): string {
		return this.getSpecialTypeOptionValue(ConnectionOptionSpecialType.databaseName);
	}

	public get userName(): string {
		return this.getSpecialTypeOptionValue(ConnectionOptionSpecialType.userName);
	}

	public get password(): string {
		return this.getSpecialTypeOptionValue(ConnectionOptionSpecialType.password);
	}

	public get authenticationType(): string {
		return this.getSpecialTypeOptionValue(ConnectionOptionSpecialType.authType);
	}

	public set serverName(value: string) {
		this.setSpecialTypeOptionName(ConnectionOptionSpecialType.serverName, value);
	}

	public set databaseName(value: string) {
		this.setSpecialTypeOptionName(ConnectionOptionSpecialType.databaseName, value);
	}

	public set userName(value: string) {
		this.setSpecialTypeOptionName(ConnectionOptionSpecialType.userName, value);
	}

	public set password(value: string) {
		this.setSpecialTypeOptionName(ConnectionOptionSpecialType.password, value);
	}

	public set authenticationType(value: string) {
		this.setSpecialTypeOptionName(ConnectionOptionSpecialType.authType, value);
	}

	public getOptionValue(name: string): any {
		return this.options[name];
	}

	public setOptionValue(name: string, value: any): void {
		//TODO: validate
		this.options[name] = value;
	}

	/**
	 * Returns the title of the connection
	 */
	public get title(): string {
		let databaseName = this.databaseName ? this.databaseName : '<default>';
		let userName = this.userName ? this.userName : 'Windows Authentication';
		let label = this.serverName + ', ' + databaseName + ' (' + userName + ')';
		return label;
	}

	/**
	 * Returns true if the capabilities and options are loaded correctly
	 */
	public get isConnectionOptionsValid(): boolean {
		return this.serverCapabilities && this.title.indexOf('undefined') < 0;
	}

	public isPasswordRequired(): boolean {
		let optionMetadata = this._serverCapabilities.connectionOptions.find(
			option => option.specialValueType === ConnectionOptionSpecialType.password);
		let isPasswordRequired: boolean = optionMetadata.isRequired;
		if (this.providerName === Constants.mssqlProviderName) {
			isPasswordRequired = this.authenticationType === ProviderConnectionInfo.SqlAuthentication && optionMetadata.isRequired;
		}
		return isPasswordRequired;
	}

	private getSpecialTypeOptionValue(type: string): string {
		let name = this.getSpecialTypeOptionName(type);
		if (name) {
			return this.options[name];
		}
		return undefined;
	}

	/**
	 * Returns a key derived the connections options (providerName, authenticationType, serverName, databaseName, userName, groupid)
	 * This key uniquely identifies a connection in a group
	 * Example: "providerName:MSSQL|authenticationType:|databaseName:database|serverName:server3|userName:user|group:testid"
	 */
	public getOptionsKey(): string {
		let idNames = [];
		if (this._serverCapabilities) {
			idNames = this._serverCapabilities.connectionOptions.map(o => {
				if ((o.specialValueType || o.isIdentity) && o.specialValueType !== ConnectionOptionSpecialType.password) {
					return o.name;
				} else {
					return undefined;
				}
			});
		} else {
			// This should never happen but just incase the serverCapabilities was not ready at this time
			idNames = ['authenticationType', 'database', 'server', 'user'];
		}

		idNames = idNames.filter(x => x !== undefined);

		//Sort to make sure using names in the same order every time otherwise the ids would be different
		idNames.sort();

		let idValues: string[] = [];
		for (var index = 0; index < idNames.length; index++) {
			let value = this.options[idNames[index]];
			value = value ? value : '';
			idValues.push(`${idNames[index]}${ProviderConnectionInfo.nameValueSeparator}${value}`);
		}

		return ProviderConnectionInfo.ProviderPropertyName + ProviderConnectionInfo.nameValueSeparator +
			this.providerName + ProviderConnectionInfo.idSeparator + idValues.join(ProviderConnectionInfo.idSeparator);
	}

	public static getProviderFromOptionsKey(optionsKey: string) {
		let providerId: string = '';
		if (optionsKey) {
			let ids: string[] = optionsKey.split(ProviderConnectionInfo.idSeparator);
			ids.forEach(id => {
				let idParts = id.split(ProviderConnectionInfo.nameValueSeparator);
				if (idParts.length >= 2 && idParts[0] === ProviderConnectionInfo.ProviderPropertyName) {
					providerId = idParts[1];
				}
			});
		}
		return providerId;
	}

	public getSpecialTypeOptionName(type: string): string {
		if (this._serverCapabilities) {
			let optionMetadata = this._serverCapabilities.connectionOptions.find(o => o.specialValueType === type);
			return !!optionMetadata ? optionMetadata.name : undefined;
		} else {
			return type.toString();
		}
	}

	public setSpecialTypeOptionName(type: string, value: string): void {
		let name = this.getSpecialTypeOptionName(type);
		if (!!name) {
			this.options[name] = value;
		}
	}

	public get authenticationTypeDisplayName(): string {
		let optionMetadata = this._serverCapabilities.connectionOptions.find(o => o.specialValueType === ConnectionOptionSpecialType.authType);
		let authType = this.authenticationType;
		let displayName: string = authType;

		if (optionMetadata && optionMetadata.categoryValues) {
			optionMetadata.categoryValues.forEach(element => {
				if (element.name === authType) {
					displayName = element.displayName;
				}
			});
		}
		return displayName;
	}

	public getProviderOptions(): sqlops.ConnectionOption[] {
		return this._serverCapabilities.connectionOptions;
	}

	public static get idSeparator(): string {
		return '|';
	}

	public static get nameValueSeparator(): string {
		return ':';
	}

	public get titleParts(): string[] {
		let parts: string[] = [];
		// Always put these three on top. TODO: maybe only for MSSQL?
		parts.push(this.serverName);
		parts.push(this.databaseName);
		parts.push(this.authenticationTypeDisplayName);

		this._serverCapabilities.connectionOptions.forEach(element => {
			if (element.specialValueType !== ConnectionOptionSpecialType.serverName &&
				element.specialValueType !== ConnectionOptionSpecialType.databaseName &&
				element.specialValueType !== ConnectionOptionSpecialType.authType &&
				element.specialValueType !== ConnectionOptionSpecialType.password &&
				element.isIdentity && element.valueType === ServiceOptionType.string) {
				let value = this.getOptionValue(element.name);
				if (value) {
					parts.push(value);
				}
			}
		});

		return parts;
	}
}
